import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { connectDB } from "../src/lib/db";
import { hashPassword, signSession } from "../src/lib/auth";
import {
  leerVerificacion,
  limpiarRespuesta,
  mensajeParaCajero,
  nuevoNumeroControl,
  esNumeroControlValido,
  tipoTarjetaDeRespuesta,
  type RespuestaPuente,
  type SolicitudPuente,
} from "../src/lib/banorte";
import { cobroPrevioDeVenta, operarTerminal, regresarCobro } from "../src/lib/cobroBanorte";
import { GET as listarTx, POST as reservarTx } from "../src/app/api/banorte/transacciones/route";
import { GET as leerTx, PATCH as reportarTx } from "../src/app/api/banorte/transacciones/[numeroControl]/route";
import { POST as vender } from "../src/app/api/ventas/route";
import { POST as cancelarVenta } from "../src/app/api/ventas/[id]/cancelar/route";
import { POST as devolver } from "../src/app/api/devoluciones/route";
import { PATCH as cerrarTarjeta } from "../src/app/api/devoluciones/[id]/tarjeta/route";
import { ticketVentaHTML } from "../src/lib/ticketVenta";
import User from "../src/models/User";
import Sucursal from "../src/models/Sucursal";
import TerminalPago from "../src/models/TerminalPago";
import CajaSesion from "../src/models/CajaSesion";
import Producto from "../src/models/Producto";
import InventarioSucursal from "../src/models/InventarioSucursal";
import Venta from "../src/models/Venta";
import TransaccionBanorte from "../src/models/TransaccionBanorte";

// Prueba de punta a punta del cobro integrado con Banorte, sin terminal ni
// banco reales: el puente de caja es un doble que contesta lo que cada caso
// necesita, y las rutas del servidor corren contra una base en memoria.

function pruebasPuras() {
  const nc = nuevoNumeroControl(new Date("2026-10-14T18:30:05Z"), () => 0.5);
  assert.match(nc, /^TT261014183005[A-Z0-9]{8}$/);
  assert.ok(nc.length <= 30 && esNumeroControlValido(nc), "alfanumérico y de máximo 30");
  assert.equal(esNumeroControlValido("TT-123"), false, "Payworks rechaza el guion");
  assert.equal(tipoTarjetaDeRespuesta("DEBITO", "VISA"), "debito");
  assert.equal(tipoTarjetaDeRespuesta("CREDITO", "AMERICAN EXPRESS"), "amex");
  assert.equal(tipoTarjetaDeRespuesta("", ""), null);
  assert.match(mensajeParaCajero({ resultado: "F", codigo: "-2006" }), /cancel/i);
  assert.match(mensajeParaCajero({ resultado: "R", codigo: "PAYW‐3003" }), /contraseña/, "acepta el guion tipográfico del anexo");
  assert.match(mensajeParaCajero({ resultado: "D", texto: "Fondos+insuficientes" }), /Fondos insuficientes/);
  const limpia = limpiarRespuesta({ resultado: "A", ultimos4: "4111111111111111", bin: "411111111111", texto: "x".repeat(500) });
  assert.equal(limpia.ultimos4, "1111", "nunca más de 4 dígitos");
  assert.equal(limpia.bin, "41111111");
  assert.equal(limpia.texto.length, 200);
  const v = leerVerificacion("VTA | 333069450547 | 525678******4494 | 400.00 | C | A | 00 | 021302 | 20180801 14:13:01.865 | 20180801 14:13:02.461 | 20180801 14:13:02.507 | 20180801 14:13:02.508 | EXTRANJERA | MASTERCARD | CREDITO | **** | 1E0300 | carlos2507180345");
  assert.deepEqual(
    v && { ref: v.referencia, u4: v.ultimos4, monto: v.monto, estatus: v.estatus, res: v.resultado, aut: v.autorizacion, nc: v.numeroControl },
    { ref: "333069450547", u4: "4494", monto: 400, estatus: "C", res: "A", aut: "021302", nc: "carlos2507180345" }
  );
  assert.equal(leerVerificacion("Aprobada"), null);
}

type Manejador = (s: SolicitudPuente) => RespuestaPuente | "sin_conexion";

/** Doble del puente de caja: guarda las respuestas como el real. */
function puenteFalso(manejar: Manejador) {
  const guardadas = new Map<string, RespuestaPuente>();
  const llamadas: SolicitudPuente[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const ruta = String(url).replace(/^https?:\/\/[^/]+/, "");
    const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
    if (ruta === "/estado") return json({ ok: true, ocupado: false, pinpad: "simulador", modo: "AUT" });
    const m = ruta.match(/^\/banorte\/resultado\/(.+)$/);
    if (m) {
      const r = guardadas.get(decodeURIComponent(m[1]));
      return r ? json(r) : json({ ok: false }, 404);
    }
    if (ruta === "/banorte/transaccion" && init?.method === "POST") {
      const s = JSON.parse(String(init.body)) as SolicitudPuente;
      llamadas.push(s);
      const r = manejar(s);
      if (r === "sin_conexion") throw new TypeError("fetch failed");
      if (s.comando !== "VERIFICACION" || !guardadas.has(s.numeroControl)) guardadas.set(s.numeroControl, r);
      return json(r);
    }
    return json({ ok: false, error: "ruta" }, 404);
  }) as typeof fetch;
  return { f, llamadas, guardadas };
}

const aprobada = (s: SolicitudPuente, extra: Partial<RespuestaPuente> = {}): RespuestaPuente => ({
  ok: true,
  comando: s.comando,
  numeroControl: s.numeroControl,
  resultado: "A",
  autorizacion: "123456",
  referencia: String(Math.floor(Math.random() * 1e12)).padStart(12, "0"),
  afiliacion: "9862356",
  tipoTarjeta: "DEBITO",
  marca: "VISA",
  banco: "BANORTE",
  ultimos4: "4321",
  modoEntrada: "CONTACTLESSCHIP",
  aid: "A0000000031010",
  modo: "AUT",
  simulado: true,
  ...extra,
});

async function main() {
  pruebasPuras();

  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("banorte_qa_aislada");
  process.env.JWT_SECRET = "banorte-pruebas-aisladas";
  delete process.env.BANORTE_SOLO_PRODUCCION;
  try {
    await connectDB();
    const [tienda, otra] = await Sucursal.create([{ nombre: "Junior · PRUEBA" }, { nombre: "Otra · PRUEBA" }]);
    const passwordHash = await hashPassword("Prueba-local-2026");
    const cajero = await User.create({
      nombre: "Caja · PRUEBA",
      email: "caja@prueba.local",
      passwordHash,
      role: "sucursal",
      sucursalId: tienda._id,
      permisosIndividuales: ["pos.vender", "pos.cancelar", "devoluciones.registrar"],
    });
    const intruso = await User.create({ nombre: "Otra", email: "otra@prueba.local", passwordHash, role: "sucursal", sucursalId: otra._id, permisosIndividuales: ["pos.vender"] });
    const token = (u: typeof cajero) =>
      signSession({ userId: String(u._id), nombre: u.nombre, email: u.email, role: u.role, sucursalId: String(u.sucursalId) });
    const [tc, ti] = await Promise.all([token(cajero), token(intruso)]);
    const req = (path: string, method = "GET", body?: unknown, auth = tc) =>
      new NextRequest(`http://localhost:3100${path}`, {
        method,
        headers: { cookie: `titos_session=${auth}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    // El "servidor" que ve cobroBanorte: despacha a las rutas reales.
    const servidor = (auth = tc) =>
      (async (url: string | URL, init?: RequestInit) => {
        const ruta = String(url);
        const metodo = init?.method ?? "GET";
        const cuerpo = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (ruta.startsWith("/api/banorte/transacciones?")) return listarTx(req(ruta, "GET", undefined, auth));
        if (ruta === "/api/banorte/transacciones") return reservarTx(req(ruta, metodo, cuerpo, auth));
        const m = ruta.match(/^\/api\/banorte\/transacciones\/([^/?]+)$/);
        if (m) {
          const params = { params: Promise.resolve({ numeroControl: decodeURIComponent(m[1]) }) };
          return metodo === "PATCH" ? reportarTx(req(ruta, metodo, cuerpo, auth), params) : leerTx(req(ruta, "GET", undefined, auth), params);
        }
        throw new Error(`ruta no simulada ${ruta}`);
      }) as typeof fetch;
    const sinEspera = async () => {};

    const [integrada, manual] = await TerminalPago.create([
      { sucursalId: tienda._id, alias: "Banorte A920", banco: "Banorte", cobroIntegrado: true, afiliacion: "9862356", numeroSerie: "053420840" },
      { sucursalId: tienda._id, alias: "Manual", banco: "BBVA" },
    ]);
    await CajaSesion.create({ sucursalId: tienda._id, usuarioAperturaId: cajero._id, efectivoInicial: 100 });
    const producto = await Producto.create({ sku: "QA-1", nombre: "Producto · PRUEBA", categoria: "Prueba", unidad: "pieza", precioVenta: 100 });
    await InventarioSucursal.create({ sucursalId: tienda._id, productoId: producto._id, stockActual: 100 });
    const ventaCon = (clienteOperacionId: string, numeroControl?: string, monto = 100) => ({
      clienteOperacionId,
      items: [{ productoId: String(producto._id), cantidad: monto / 100 }],
      pagos: [{ metodoPago: "tarjeta", monto, terminalId: String(integrada._id), ...(numeroControl ? { banorteNumeroControl: numeroControl } : {}) }],
    });

    // --- Reserva: solo terminales integradas de la propia tienda ---
    assert.equal((await reservarTx(req("/api/banorte/transacciones", "POST", { comando: "VENTA", terminalId: String(manual._id), monto: 100 }))).status, 400);
    assert.equal((await reservarTx(req("/api/banorte/transacciones", "POST", { comando: "VENTA", terminalId: String(integrada._id), monto: 100 }, ti))).status, 400, "otra tienda no usa esta terminal");
    assert.equal((await reservarTx(req("/api/banorte/transacciones", "POST", { comando: "REVERSA", terminalId: String(integrada._id) }))).status, 400, "la reversa no se reserva");

    // --- 1. Cobro aprobado y venta amarrada ---
    const p1 = puenteFalso((s) => aprobada(s));
    const r1 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 100, clienteOperacionId: "op-1" },
      { fetchServidor: servidor(), fetchPuente: p1.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r1.aprobada, true, r1.mensaje);
    assert.equal(p1.llamadas[0].monto, 100, "el monto lo fija el servidor");
    const nc1 = r1.transaccion.numeroControl;

    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-1x", nc1, 50)))).status, 400, "el monto de la tarjeta debe ser el cobrado");
    const resVenta = await vender(req("/api/ventas", "POST", ventaCon("op-1", nc1)));
    assert.equal(resVenta.status, 201, await resVenta.clone().text());
    const venta1 = await resVenta.json();
    const pago1 = venta1.pagos[0];
    assert.equal(pago1.banorte.numeroControl, nc1);
    assert.equal(pago1.banorte.ultimos4, "4321");
    assert.equal(pago1.autorizacion, "123456");
    assert.equal(pago1.tarjetaTipo, "debito", "el tipo lo dice el banco");
    assert.equal(pago1.banorteNumeroControl, undefined);
    const tx1 = await TransaccionBanorte.findOne({ numeroControl: nc1 }).lean<{ aplicada: boolean; ventaId: unknown; afiliacion: string }>();
    assert.equal(tx1?.aplicada, true);
    assert.equal(String(tx1?.ventaId), String(venta1._id));
    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-otra", nc1)))).status, 409, "un cobro, una venta");
    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-1", nc1)))).status, 200, "el reintento devuelve la misma venta");
    const html = ticketVentaHTML(venta1, { zonaHoraria: "America/Tijuana" });
    assert.match(html, /BANORTE · VENTA/);
    assert.match(html, /PRUEBA · SIN VALOR/);
    assert.match(html, /\*{12}4321/);
    assert.match(html, /9862356/);

    // --- 2. Modo de prueba bloqueado ya certificados ---
    const r2 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 100, clienteOperacionId: "op-2" },
      { fetchServidor: servidor(), fetchPuente: p1.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    process.env.BANORTE_SOLO_PRODUCCION = "1";
    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-2", r2.transaccion.numeroControl)))).status, 400);
    delete process.env.BANORTE_SOLO_PRODUCCION;
    // Ese cobro quedó aprobado sin venta: el reintento lo encuentra en vez de cobrar otra vez.
    const previo = await cobroPrevioDeVenta("op-2", 100, { fetchServidor: servidor(), fetchPuente: p1.f, urlPuente: "http://puente" });
    assert.equal(previo?.numeroControl, r2.transaccion.numeroControl);
    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-2", previo!.numeroControl)))).status, 201);

    // --- 3. Sin respuesta (T) → verificación dice aprobada ---
    const p3 = puenteFalso((s) =>
      s.comando === "VENTA"
        ? { ok: true, comando: "VENTA", numeroControl: s.numeroControl, resultado: "T", texto: "Sin respuesta" }
        : aprobada(s, {
            texto: `VTA | 777000111222 | 545608******9876 | 80.00 | C | A | 00 | 654321 | x | x | x | x | BANORTE | MASTERCARD | CREDITO | **** | 1E0300 | ${s.numeroControl}`,
            referencia: "",
            autorizacion: "",
            ultimos4: "",
          })
    );
    const r3 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 80, clienteOperacionId: "op-3" },
      { fetchServidor: servidor(), fetchPuente: p3.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r3.aprobada, true);
    assert.deepEqual(p3.llamadas.map((l) => l.comando), ["VENTA", "VERIFICACION"]);
    assert.equal(r3.transaccion.referencia, "777000111222", "los datos salen de la verificación");
    assert.equal(r3.transaccion.ultimos4, "9876");

    // --- 4. Se pierde la conexión y Payworks no la conoce → no hubo cobro ---
    const p4 = puenteFalso((s) =>
      s.comando === "VENTA" ? "sin_conexion" : { ok: true, comando: s.comando, numeroControl: s.numeroControl, resultado: "R", codigo: "PAYW-3012", texto: "No existe" }
    );
    const r4 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 60, clienteOperacionId: "op-4" },
      { fetchServidor: servidor(), fetchPuente: p4.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r4.aprobada, false);
    assert.equal(r4.estado, "error");
    assert.deepEqual(p4.llamadas.map((l) => l.comando), ["VENTA", "VERIFICACION"], "no se reversa lo que no existe");

    // --- 5. Verificación tampoco sabe → se reversa ---
    const p5 = puenteFalso((s) =>
      s.comando === "VENTA" || s.comando === "VERIFICACION"
        ? { ok: true, comando: s.comando, numeroControl: s.numeroControl, resultado: "T" }
        : aprobada(s)
    );
    const r5 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 70, clienteOperacionId: "op-5" },
      { fetchServidor: servidor(), fetchPuente: p5.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r5.estado, "reversada");
    assert.deepEqual(p5.llamadas.map((l) => l.comando), ["VENTA", "VERIFICACION", "REVERSA"]);
    assert.equal(p5.llamadas[2].numeroControl, r5.transaccion.numeroControl, "la reversa va con el número de control original");

    // --- 6. Declinada: no hay venta ---
    const p6 = puenteFalso((s) => ({ ok: true, comando: s.comando, numeroControl: s.numeroControl, resultado: "D", texto: "Fondos+insuficientes" }));
    const r6 = await operarTerminal(
      { comando: "VENTA", terminalId: String(integrada._id), monto: 100, clienteOperacionId: "op-6" },
      { fetchServidor: servidor(), fetchPuente: p6.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r6.aprobada, false);
    assert.match(r6.mensaje, /Fondos insuficientes/);
    assert.equal((await vender(req("/api/ventas", "POST", ventaCon("op-6", r6.transaccion.numeroControl)))).status, 400);
    // Un reporte posterior no convierte una declinada en aprobada.
    const cambio = await reportarTx(
      req(`/api/banorte/transacciones/${r6.transaccion.numeroControl}`, "PATCH", { respuesta: { comando: "VENTA", resultado: "A" } }),
      { params: Promise.resolve({ numeroControl: r6.transaccion.numeroControl }) }
    );
    assert.equal(cambio.status, 409);

    // --- 7. Cancelar la venta 1: primero en el banco ---
    const urlCancelar = `/api/ventas/${venta1._id}/cancelar`;
    const params1 = { params: Promise.resolve({ id: String(venta1._id) }) };
    assert.equal((await cancelarVenta(req(urlCancelar, "POST", { motivo: "Prueba" }), params1)).status, 409, "sin cancelar en el banco no procede");
    const validacion = await (await cancelarVenta(req(urlCancelar, "POST", { motivo: "Prueba", soloValidar: true }), params1)).json();
    assert.equal(validacion.cobroBanorte.monto, 100);
    assert.equal((await Venta.findById(venta1._id).lean<{ estado: string }>())?.estado, "completada", "validar no cancela");
    const p7 = puenteFalso((s) => (s.comando === "CANCELACION" ? { ok: true, comando: s.comando, numeroControl: s.numeroControl, resultado: "R", codigo: "PAYW-3025" } : aprobada(s)));
    const r7 = await regresarCobro(
      { terminalId: String(integrada._id), monto: 100, transaccionOriginalId: validacion.cobroBanorte.transaccionId },
      { fetchServidor: servidor(), fetchPuente: p7.f, urlPuente: "http://puente", esperar: sinEspera }
    );
    assert.equal(r7.aprobada, true);
    assert.equal(r7.transaccion.comando, "DEVOLUCION", "lote cerrado: la cancelación cae a devolución");
    assert.equal(p7.llamadas[1].referencia, tx1 && (await TransaccionBanorte.findOne({ numeroControl: nc1 }))?.referencia);
    const cancelada = await cancelarVenta(req(urlCancelar, "POST", { motivo: "Prueba", banorteNumeroControl: r7.transaccion.numeroControl }), params1);
    assert.equal(cancelada.status, 200, await cancelada.clone().text());
    const original = await TransaccionBanorte.findOne({ numeroControl: nc1 }).lean<{ montoDevuelto: number }>();
    assert.equal(original?.montoDevuelto, 100);

    // --- 8. Devolución parcial a la tarjeta ---
    const p8 = puenteFalso((s) => aprobada(s));
    const d8 = { fetchServidor: servidor(), fetchPuente: p8.f, urlPuente: "http://puente", esperar: sinEspera };
    const r8 = await operarTerminal({ comando: "VENTA", terminalId: String(integrada._id), monto: 300, clienteOperacionId: "op-8" }, d8);
    const venta8 = await (await vender(req("/api/ventas", "POST", ventaCon("op-8", r8.transaccion.numeroControl, 300)))).json();
    const resDev = await devolver(req("/api/devoluciones", "POST", { ventaId: String(venta8._id), items: [{ productoId: String(producto._id), cantidad: 1 }], motivo: "Prueba", aTarjeta: true }));
    assert.equal(resDev.status, 201, await resDev.clone().text());
    const dev = await resDev.json();
    assert.equal(dev.montoTarjeta, 100);
    assert.equal(dev.montoEfectivo, 0, "no sale efectivo del cajón");
    assert.equal(dev.tarjeta.estado, "pendiente");
    const rDev = await operarTerminal(
      { comando: "DEVOLUCION", terminalId: String(integrada._id), monto: 100, transaccionOriginalId: String(dev.tarjeta.transaccionOriginalId), devolucionId: dev._id },
      d8
    );
    assert.equal(rDev.aprobada, true);
    const pTarjeta = { params: Promise.resolve({ id: String(dev._id) }) };
    const cerrada = await (await cerrarTarjeta(req(`/api/devoluciones/${dev._id}/tarjeta`, "PATCH", { numeroControl: rDev.transaccion.numeroControl }), pTarjeta)).json();
    assert.equal(cerrada.tarjeta.estado, "aprobada");
    assert.equal(cerrada.tarjeta.ultimos4, "4321");
    assert.equal((await cerrarTarjeta(req(`/api/devoluciones/${dev._id}/tarjeta`, "PATCH", { convertirEfectivo: true }), pTarjeta)).status, 409, "ya está cerrada");
    // No se puede devolver a la tarjeta más de lo cobrado.
    const excede = await reservarTx(req("/api/banorte/transacciones", "POST", { comando: "DEVOLUCION", terminalId: String(integrada._id), monto: 250, transaccionOriginalId: String(dev.tarjeta.transaccionOriginalId) }));
    assert.equal(excede.status, 400);

    // --- 9. Devolución a tarjeta que la terminal no aplica → efectivo ---
    const dev2 = await (await devolver(req("/api/devoluciones", "POST", { ventaId: String(venta8._id), items: [{ productoId: String(producto._id), cantidad: 1 }], motivo: "Prueba", aTarjeta: true }))).json();
    const conv = await (await cerrarTarjeta(req(`/api/devoluciones/${dev2._id}/tarjeta`, "PATCH", { convertirEfectivo: true }), { params: Promise.resolve({ id: String(dev2._id) }) })).json();
    assert.equal(conv.montoEfectivo, 100);
    assert.equal(conv.montoTarjeta, 0);
    assert.equal(conv.estado, "pagada", "hay caja abierta");

    console.log(
      "OK: número de control, verificación, limpieza de datos de tarjeta, reserva por tienda, cobro aprobado y amarrado, " +
        "un cobro por venta, reintento sin cobro doble, bloqueo de modo prueba, T→verificación, conexión perdida, reversa, " +
        "declinada, cancelación con caída a devolución, devolución parcial a tarjeta y conversión a efectivo. Sin terminal ni banco reales."
    );
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
