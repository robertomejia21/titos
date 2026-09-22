import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { connectDB } from "../src/lib/db";
import { hashPassword, signSession } from "../src/lib/auth";
import { EQUIPO_VACIO, pesoEnKg, validarEquipoCaja, autorizacionTarjeta } from "../src/lib/equiposCaja";
import { leerPuertoDiagnostico, type PuertoSerial } from "../src/lib/serialDiagnostico";
import { GET, PUT } from "../src/app/api/equipos-caja/route";
import { POST as vender } from "../src/app/api/ventas/route";
import User from "../src/models/User";
import Sucursal from "../src/models/Sucursal";
import TerminalPago from "../src/models/TerminalPago";
import CajaSesion from "../src/models/CajaSesion";
import Producto from "../src/models/Producto";
import InventarioSucursal from "../src/models/InventarioSucursal";
import Venta from "../src/models/Venta";
import { ticketVentaHTML } from "../src/lib/ticketVenta";

async function serialTests() {
  for (const modo of ["datos", "limite", "silencio", "desconexion", "abortar"] as const) {
    const abort = new AbortController();
    let cerrado = false;
    const port: PuertoSerial = {
      open: async options => { assert.equal(options.baudRate, 9600); },
      close: async () => { assert.equal(port.readable!.locked, false); cerrado = true; },
      readable: new ReadableStream<Uint8Array>({ start(controller) {
        if (modo === "datos") { controller.enqueue(new Uint8Array([2, 49, 46, 50, 53, 48, 13])); controller.close(); }
        if (modo === "limite") controller.enqueue(new Uint8Array(5000));
        if (modo === "desconexion") controller.error(new Error("Desconectado"));
      } }),
    };
    if (modo === "abortar") setTimeout(() => abort.abort(), 5);
    const lectura = leerPuertoDiagnostico({ requestPort: async () => port }, { ...EQUIPO_VACIO, baudRate: 9600 }, abort.signal, 10);
    if (modo === "desconexion") await assert.rejects(lectura, /Desconectado/);
    else assert.equal((await lectura).length, modo === "datos" ? 7 : modo === "limite" ? 4096 : 0);
    assert.equal(cerrado, true, `${modo}: libera el puerto`);
  }
}

async function main() {
  assert.equal(pesoEnKg("1,250"), 1.25);
  assert.equal(pesoEnKg("1250", "g"), 1.25);
  assert.equal(pesoEnKg("1.250")! * 80, 100);
  for (const invalid of ["0", "-1", "Infinity", "1e3", "1.2345", "", "1kg"]) assert.equal(pesoEnKg(invalid), null);
  assert.equal(pesoEnKg("1.5", "g"), null, "No redondear gramos fraccionarios silenciosamente");
  assert.equal(autorizacionTarjeta(" 012345 "), "012345");
  assert.throws(() => autorizacionTarjeta("4111111111111111"));
  assert.throws(() => validarEquipoCaja({ ...EQUIPO_VACIO, banorteIntegracion: "conectada" }));
  assert.throws(() => validarEquipoCaja({ ...EQUIPO_VACIO, exigirAutorizacion: true }));
  await serialTests();
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("equipos_caja_qa_aislada");
  process.env.JWT_SECRET = "equipos-caja-pruebas-aisladas";
  try {
    await connectDB();
    const [junior, otra] = await Sucursal.create([{ nombre: "Junior · PRUEBA" }, { nombre: "Otra · PRUEBA" }]);
    const passwordHash = await hashPassword("Prueba-local-2026");
    const admin = await User.create({ nombre: "Admin · PRUEBA", email: "admin@prueba.local", passwordHash, role: "matriz" });
    const cajero = await User.create({ nombre: "Caja · PRUEBA", email: "caja@prueba.local", passwordHash, role: "sucursal", sucursalId: junior._id, permisosIndividuales: ["pos.vender"] });
    const consulta = await User.create({ nombre: "Consulta · PRUEBA", email: "consulta@prueba.local", passwordHash, role: "matriz", permisosIndividuales: ["configuracion.editar"], permisosSoloConsulta: ["configuracion.editar"] });
    const token = async (u: typeof admin) => signSession({ userId: String(u._id), nombre: u.nombre, email: u.email, role: u.role, sucursalId: u.sucursalId ? String(u.sucursalId) : null });
    const [a, c, ro] = await Promise.all([token(admin), token(cajero), token(consulta)]);
    const req = (path: string, method = "GET", body?: unknown, auth = a) => new NextRequest(`http://localhost:3100${path}`, { method, headers: { cookie: `titos_session=${auth}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const [terminal, otraTerminal] = await TerminalPago.create([{ sucursalId: junior._id, alias: "Banorte · PRUEBA", banco: "Banorte" }, { sucursalId: otra._id, alias: "Otra", banco: "Banorte" }]);
    const config = { ...EQUIPO_VACIO, nombreCaja: "Caja Junior", terminalId: String(terminal._id), exigirAutorizacion: true };
    const datos = { sucursalId: String(junior._id), configuracion: config };
    assert.equal((await GET(req("/api/equipos-caja", "GET", undefined, ""))).status, 401);
    assert.equal((await PUT(req("/api/equipos-caja", "PUT", datos))).status, 200);
    const guardado = await (await GET(req(`/api/equipos-caja?sucursalId=${junior._id}`))).json();
    assert.deepEqual(guardado.equipo.configuracion, config);
    assert.equal(guardado.equipo.actualizadoPor, admin.nombre);
    const aislado = await (await GET(req(`/api/equipos-caja?sucursalId=${otra._id}`, "GET", undefined, c))).json();
    assert.equal(aislado.sucursalId, String(junior._id));
    assert.equal(aislado.sucursales.length, 1);
    assert.equal(aislado.puedeEditar, false);
    assert.equal(aislado.terminales[0]._id, String(terminal._id));
    assert.equal((await PUT(req("/api/equipos-caja", "PUT", datos, c))).status, 401);
    assert.equal((await PUT(req("/api/equipos-caja", "PUT", datos, ro))).status, 401);
    assert.equal((await PUT(req("/api/equipos-caja", "PUT", { ...datos, configuracion: { ...config, terminalId: String(otraTerminal._id) } }))).status, 400);
    await CajaSesion.create({ sucursalId: junior._id, usuarioAperturaId: cajero._id, efectivoInicial: 100 });
    const producto = await Producto.create({ sku: "PESO-QA", nombre: "Producto kg · PRUEBA", categoria: "Prueba", unidad: "kg", requierePesaje: true, precioVenta: 80 });
    await InventarioSucursal.create({ sucursalId: junior._id, productoId: producto._id, stockActual: 100 });
    const venta = { clienteOperacionId: "peso-qa-1", items: [{ productoId: String(producto._id), cantidad: 1.25 }], pagos: [{ metodoPago: "tarjeta", monto: 100, terminalId: String(terminal._id), tarjetaTipo: "debito", autorizacion: "" }] };
    assert.equal((await vender(req("/api/ventas", "POST", venta, c))).status, 400, "La API exige folio según sucursal");
    assert.equal(await Venta.countDocuments(), 0);
    venta.pagos[0].autorizacion = "012345";
    const res = await vender(req("/api/ventas", "POST", venta, c));
    assert.equal(res.status, 201, await res.clone().text());
    const creada = await res.json();
    assert.equal(creada.total, 100); assert.equal(creada.items[0].cantidad, 1.25);
    assert.equal(creada.pagos[0].autorizacion, "012345");
    assert.equal(creada.pagos[0].terminalAlias, terminal.alias);
    assert.match(ticketVentaHTML(creada, { zonaHoraria: "America/Tijuana" }), /Autorización capturada: 012345/);
    assert.equal((await InventarioSucursal.findOne({ productoId: producto._id })).stockActual, 98.75);
    assert.equal((await vender(req("/api/ventas", "POST", venta, c))).status, 200);
    assert.equal(await Venta.countDocuments(), 1, "Reintentar no duplica la venta ni descuenta dos veces");
    assert.equal((await InventarioSucursal.findOne({ productoId: producto._id })).stockActual, 98.75);
    await PUT(req("/api/equipos-caja", "PUT", { ...datos, configuracion: { ...config, exigirAutorizacion: false } }));
    venta.clienteOperacionId = "peso-qa-2"; venta.pagos[0].autorizacion = "";
    assert.equal((await vender(req("/api/ventas", "POST", venta, c))).status, 201, "La administradora puede desactivar la exigencia");
    console.log("OK: peso kg/g, precisión, diagnóstico serial simulado y cierre, permisos y aislamiento por sucursal, guardado de configuración, folio obligatorio/opcional, venta 1.250 kg × $80 = $100, stock e idempotencia. Sin hardware ni banco reales.");
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
