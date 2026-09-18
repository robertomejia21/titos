import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { connectDB } from "../src/lib/db";
import { signSession, hashPassword } from "../src/lib/auth";
import { fechaEnZona, sumarDias } from "../src/lib/zonasHorarias";
import {
  GET as resumen,
  POST as generar,
} from "../src/app/api/facturas/global/route";
import { PATCH as cancelar } from "../src/app/api/facturas/global/[id]/route";
import { GET as pdf } from "../src/app/api/facturas/global/[id]/pdf/route";
import { POST as individual } from "../src/app/api/facturas/route";
import { PATCH as cancelarIndividual } from "../src/app/api/facturas/[id]/route";
import { GET as bandeja } from "../src/app/api/facturas/ventas/route";
import User from "../src/models/User";
import Venta from "../src/models/Venta";
import Factura from "../src/models/Factura";
import Global from "../src/models/FacturaGlobal";
import Sucursal from "../src/models/Sucursal";
import Devolucion from "../src/models/Devolucion";
import { PDFDocument } from "pdf-lib";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("global_aislada");
  process.env.JWT_SECRET = "global-diaria-pruebas-aisladas";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    await Global.init();
    await Factura.init();
    const admin = await User.create({
      nombre: "Administración de prueba",
      email: "admin@prueba.local",
      passwordHash: await hashPassword("Prueba-local-2026"),
      role: "matriz",
    });
    const token = await signSession({
      userId: String(admin._id),
      nombre: admin.nombre,
      email: admin.email,
      role: "matriz",
      sucursalId: null,
    });
    const req = (path: string, method = "GET", body?: unknown, auth = token) =>
      new NextRequest(`http://localhost:3100${path}`, {
        method,
        headers: {
          cookie: `titos_session=${auth}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const ctx = (id: unknown) => ({
      params: Promise.resolve({ id: String(id) }),
    });
    const [s1, s2] = await Sucursal.create([
      { nombre: "Sucursal Norte · prueba" },
      { nombre: "Sucursal Sur · prueba" },
    ]);
    const dia = sumarDias(fechaEnZona(new Date()), -1);
    const venta = async (folio: string, total: number, suc = s1, extra = {}) =>
      Venta.create({
        folio,
        total,
        sucursalId: suc._id,
        cajaSesionId: new mongoose.Types.ObjectId(),
        usuarioId: admin._id,
        corte: dia,
        fecha: new Date(`${dia}T20:00:00Z`),
        items: [
          {
            productoId: new mongoose.Types.ObjectId(),
            sku: folio,
            nombreProducto: "Producto de prueba",
            unidad: "pieza",
            cantidad: 1,
            precioUnitario: total,
            subtotal: total,
          },
        ],
        pagos: [{ metodoPago: "efectivo", monto: total }],
        ...extra,
      });
    const a = await venta("PRUEBA-001", 100);
    const b = await venta("PRUEBA-002", 50.25, s1, { esVentas2: true });
    const c = await venta("PRUEBA-003", 75, s2, {
      pagos: [{ metodoPago: "credito", monto: 75 }],
    });
    await venta("PRUEBA-CANCELADA", 999, s1, { estado: "cancelada" });
    await venta("PRUEBA-OTRO-DIA", 999, s1, { corte: sumarDias(dia, -1) });
    await Devolucion.create({
      folio: "DEV-PRUEBA",
      sucursalId: s1._id,
      ventaId: a._id,
      ventaFolio: a.folio,
      ventaFecha: a.fecha,
      total: 20,
      montoEfectivo: 20,
      estado: "pagada",
      usuarioId: admin._id,
      corte: dia,
      cortePago: dia,
    });
    const receptor = {
      razonSocial: "Cliente de prueba",
      rfc: "XAXX010101000",
      regimenFiscal: "616",
      usoCfdi: "S01",
      codigoPostal: "21100",
    };
    const bodyIndividual = (v: typeof a) => ({
      ventaId: String(v._id),
      receptor,
      tasaIva: 0,
    });
    let res = await individual(req("/api/facturas", "POST", bodyIndividual(a)));
    assert.equal(res.status, 201, await res.clone().text());
    const fa = await res.json();
    const leer = async (sucursalId = "") => {
      const r = await resumen(
        req(`/api/facturas/global?dia=${dia}&sucursalId=${sucursalId}`),
      );
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    let r = await leer();
    assert.equal(r.totalVentas, 225.25);
    assert.equal(r.totalIndividuales, 100);
    assert.equal(r.totalPendiente, 125.25);
    assert.equal(r.credito, 75);
    assert.equal(r.devolucionesDia, 20);
    assert.equal(r.netoTrasDevoluciones, 205.25);
    assert.equal(r.diferencia, 0);
    const post = (r: { dia: string; sucursalId: string; huella: string }) =>
      generar(
        req("/api/facturas/global", "POST", {
          dia: r.dia,
          sucursalId: r.sucursalId,
          huella: r.huella,
        }),
      );
    const concurrentes = await Promise.all([post(r), post(r)]);
    assert.deepEqual(concurrentes.map((x) => x.status).sort(), [201, 409]);
    const g = await concurrentes.find((x) => x.status === 201)!.json();
    assert.equal(g.ventas.length, 2);
    assert.equal(g.total, 125.25);
    assert.equal(g.sucursalId, null);
    assert.equal(g.periodicidad, "01");
    assert.equal(await Global.countDocuments({ estado: "generada", dia }), 1);
    assert.equal(
      (await individual(req("/api/facturas", "POST", bodyIndividual(b))))
        .status,
      409,
    );
    const pendientes = await (
      await bandeja(req(`/api/facturas/ventas?desde=${dia}&hasta=${dia}`))
    ).json();
    assert.equal(pendientes.length, 0);
    r = await leer();
    assert.equal(r.totalPendiente, 0);
    assert.equal(r.totalGlobales, 125.25);
    assert.equal(r.diferencia, 0);
    const parcial = await leer(String(s1._id));
    assert.equal(parcial.totalVentas, 150.25);
    assert.equal(parcial.totalGlobales, 50.25);
    assert.equal(parcial.globales[0].total, 125.25);
    assert.equal(parcial.diferencia, 0);
    const pdfRes = await pdf(
      req(`/api/facturas/global/${g._id}/pdf`),
      ctx(g._id),
    );
    assert.equal(pdfRes.status, 200);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    assert.ok((await PDFDocument.load(pdfBytes)).getPageCount() >= 1);
    if (process.argv.includes("--pdf")) {
      await mkdir("outputs", { recursive: true });
      await writeFile("outputs/global-diaria-prueba.pdf", pdfBytes);
    }
    assert.equal(
      (
        await cancelar(
          req(`/api/facturas/global/${g._id}`, "PATCH", {
            motivo: "Cliente solicita factura individual",
          }),
          ctx(g._id),
        )
      ).status,
      200,
    );
    assert.equal((await Venta.findById(b._id)).facturaGlobalId, null);
    r = await leer();
    assert.equal(r.totalGlobales, 0);
    assert.equal(r.totalPendiente, 125.25);
    res = await individual(req("/api/facturas", "POST", bodyIndividual(b)));
    assert.equal(res.status, 201);
    assert.equal(
      (await post(r)).status,
      409,
      "La vista previa anterior ya no puede generar",
    );
    r = await leer();
    assert.equal(r.totalIndividuales, 150.25);
    assert.equal(r.totalPendiente, 75);
    res = await post(r);
    assert.equal(res.status, 201, await res.clone().text());
    const nueva = await res.json();
    assert.equal(nueva.total, 75);
    assert.equal(
      (
        await cancelarIndividual(
          req(`/api/facturas/${fa._id}`, "PATCH", {
            accion: "cancelar",
            motivo: "Prueba de recálculo",
          }),
          ctx(fa._id),
        )
      ).status,
      200,
    );
    r = await leer();
    assert.equal(r.totalPendiente, 100);
    assert.equal(r.diferencia, 0);
    assert.equal(
      (await post(r)).status,
      409,
      "Requiere cancelar la global existente para añadir ventas",
    );
    await Venta.updateOne(
      { _id: c._id },
      { $set: { corte: sumarDias(dia, -1) } },
    );
    r = await leer();
    assert.notEqual(r.diferencia, 0);
    assert.ok(r.avisos.length > 0);
    assert.equal((await post(r)).status, 409);
    await Venta.updateOne({ _id: c._id }, { $set: { corte: dia } });
    for (const q of ["dia=2026-02-31", "dia=abc", "sucursalId=abc"])
      assert.equal(
        (await resumen(req(`/api/facturas/global?${q}`))).status,
        400,
      );
    assert.equal(
      (await resumen(req("/api/facturas/global", "GET", undefined, ""))).status,
      401,
    );
    const lectura = await User.create({
      nombre: "Consulta",
      email: "lectura@prueba.local",
      passwordHash: "no-login",
      role: "matriz",
      permisosIndividuales: ["facturas.administrar"],
      permisosSoloConsulta: ["facturas.administrar"],
    });
    const lecturaToken = await signSession({
      userId: String(lectura._id),
      nombre: lectura.nombre,
      email: lectura.email,
      role: "matriz",
      sucursalId: null,
    });
    assert.equal(
      (
        await resumen(
          req("/api/facturas/global", "GET", undefined, lecturaToken),
        )
      ).status,
      200,
    );
    assert.equal(
      (await generar(req("/api/facturas/global", "POST", r, lecturaToken)))
        .status,
      401,
    );
    assert.equal(
      (
        await cancelar(
          req(
            `/api/facturas/global/${nueva._id}`,
            "PATCH",
            { motivo: "Intento" },
            lecturaToken,
          ),
          ctx(nueva._id),
        )
      ).status,
      401,
    );
    const hoy = fechaEnZona(new Date());
    await venta("PRUEBA-HOY", 10, s1, { corte: hoy });
    const rh = await (
      await resumen(req(`/api/facturas/global?dia=${hoy}`))
    ).json();
    assert.equal((await post(rh)).status, 409);
    // Las dos emisiones compiten por la misma venta; solo una puede reservarla.
    const raceDia = sumarDias(dia, -3);
    const race = await venta("PRUEBA-CARRERA", 15, s1, { corte: raceDia });
    const rr = await (
      await resumen(req(`/api/facturas/global?dia=${raceDia}`))
    ).json();
    const racing = await Promise.all([
      post(rr),
      individual(req("/api/facturas", "POST", bodyIndividual(race))),
    ]);
    assert.deepEqual(racing.map((x) => x.status).sort(), [201, 409]);
    // Más ventas que el antiguo límite de la bandeja: la global no debe truncarlas.
    const largoDia = sumarDias(dia, -5);
    await Venta.insertMany(
      Array.from({ length: 601 }, (_, i) => ({
        folio: `LARGO-${i}`,
        total: 0.01,
        sucursalId: s1._id,
        cajaSesionId: new mongoose.Types.ObjectId(),
        usuarioId: admin._id,
        corte: largoDia,
        pagos: [],
        items: [],
      })),
    );
    const largo = await (
      await resumen(req(`/api/facturas/global?dia=${largoDia}`))
    ).json();
    assert.equal(largo.pendientes.length, 601);
    assert.equal(largo.totalPendiente, 6.01);
    console.log(
      "OK: global de todas las tiendas y por sucursal, exclusiones, centavos, conciliación, crédito/devoluciones, doble clic, concurrencia individual/global, cancelación y regeneración, PDF, permisos, fechas, y 601 tickets sin truncar.",
    );
    if (process.argv.includes("--serve")) {
      server = spawn("npm", ["run", "dev", "--", "--port", "3100"], {
        stdio: "inherit",
        env: process.env,
      });
      await new Promise<void>((resolve) => {
        server!.on("exit", resolve);
        process.on("SIGTERM", () => {
          server?.kill();
          resolve();
        });
      });
    }
  } finally {
    server?.kill();
    await mongoose.disconnect();
    await mongo.stop();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
