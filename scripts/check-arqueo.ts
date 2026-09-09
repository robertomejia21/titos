import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/caja/arqueo/route";
import { connectDB } from "../src/lib/db";
import { hashPassword, signSession, type SessionPayload } from "../src/lib/auth";
import User from "../src/models/User";
import Rol from "../src/models/Rol";
import Sucursal from "../src/models/Sucursal";
import Caja from "../src/models/CajaSesion";
import Arqueo, { IntentoArqueo } from "../src/models/Arqueo";
import Venta from "../src/models/Venta";
import Movimiento from "../src/models/MovimientoCaja";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_arqueo_pruebas");
  process.env.JWT_SECRET = "solo-pruebas-aisladas-arqueo-2026";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    const suc = await Sucursal.create({ nombre: "Sucursal prueba arqueo" });
    const otra = await Sucursal.create({ nombre: "Otra sucursal prueba" });
    const user = await User.create({ nombre: "Cajero prueba", email: "sucursal@titos.local", passwordHash: await hashPassword("Pruebas-locales-2026"), role: "sucursal", sucursalId: suc._id });
    const rol = await Rol.create({ nombre: "Supervisor prueba", ambito: "sucursal", esSupervisor: true });
    const supervisor = await User.create({ nombre: "Supervisor prueba", email: "supervisor@titos.local", passwordHash: await hashPassword("Pruebas-locales-2026"), role: "sucursal", sucursalId: suc._id, rolId: rol._id, nipOperacionHash: await hashPassword("654321") });
    await User.create({ nombre: "Supervisor ajeno", email: "otro@titos.local", passwordHash: "no-login", role: "sucursal", sucursalId: otra._id, rolId: rol._id, nipOperacionHash: await hashPassword("123456") });
    const caja = await Caja.create({ sucursalId: suc._id, usuarioAperturaId: user._id, efectivoInicial: 100, efectivoInicialUsd: 20 });
    await Venta.create({ folio: "V-ARQUEO", sucursalId: suc._id, usuarioId: user._id, cajaSesionId: caja._id, corte: "2026-09-09", items: [], total: 200,
      pagos: [{ metodoPago: "efectivo", monto: 50 }, { metodoPago: "tarjeta", monto: 80 }, { metodoPago: "efectivo_usd", monto: 70, montoUsd: 5, tipoCambio: 17 }] });
    const sesion: SessionPayload = { userId: String(user._id), email: user.email, nombre: user.nombre, role: "sucursal", sucursalId: String(suc._id), permisos: ["pos.vender"] };
    const token = await signSession(sesion);
    async function llamar(body: unknown, credencial = token) { return POST(new NextRequest("http://localhost/api/caja/arqueo", { method: "POST", headers: { cookie: `titos_session=${credencial}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
    async function consultar() { const res = await llamar({ accion: "consultar", nip: "654321" }); assert.equal(res.status, 200); return res.json(); }
    assert.equal((await llamar({ accion: "consultar", nip: "654321" }, "")).status, 401);
    assert.equal((await llamar({ accion: "consultar", nip: "654321" }, await signSession({ ...sesion, permisos: ["productos.ver"] }))).status, 403);
    assert.equal((await llamar({ accion: "consultar", nip: "000000" })).status, 403);
    assert.equal((await llamar({ accion: "consultar", nip: "123456" })).status, 403);
    const duplicado = await User.create({ nombre: "NIP repetido", email: "duplicado@titos.local", passwordHash: "no-login", role: "sucursal", sucursalId: suc._id, rolId: rol._id, nipOperacionHash: await hashPassword("654321") });
    assert.equal((await llamar({ accion: "consultar", nip: "654321" })).status, 403);
    await User.updateOne({ _id: duplicado._id }, { activo: false });
    const consulta = await consultar();
    assert.equal(consulta.efectivoEsperado, 135, "100 + 50 - 15 de cambio USD");
    assert.equal(consulta.efectivoEsperadoUsd, 25);
    assert.equal(consulta.supervisorNombre, "Supervisor prueba");
    assert.equal(consulta.tokenHash, undefined);
    const guardar = { accion: "guardar", id: consulta._id, token: consulta.token, efectivoContado: 130, efectivoContadoUsd: 26, notas: "Conteo supervisado" };
    assert.equal((await llamar({ ...guardar, token: "a".repeat(64) })).status, 403);
    assert.equal((await llamar({ ...guardar, efectivoContado: null })).status, 400);
    assert.equal((await llamar({ ...guardar, efectivoContado: -1 })).status, 400);
    assert.equal((await llamar({ ...guardar, efectivoContado: 1.001 })).status, 400);
    const paralelo = await Promise.all([llamar(guardar), llamar(guardar)]);
    assert.deepEqual(paralelo.map((r) => r.status), [200, 200]);
    const guardado = await paralelo[0].json();
    assert.equal(guardado.diferencia, -5); assert.equal(guardado.diferenciaUsd, 1);
    assert.equal(guardado.tokenHash, undefined);
    assert.equal(await Arqueo.countDocuments({ estado: "guardado" }), 1);
    assert.equal((await Caja.findById(caja._id)).estado, "abierta");
    assert.equal(await Movimiento.countDocuments(), 0);
    assert.equal(String((await Arqueo.findById(consulta._id)).supervisorId), String(supervisor._id));
    const nueva = await consultar();
    assert.equal(nueva.recientes.length, 1); assert.equal(nueva.recientes[0].notas, "Conteo supervisado");
    assert.equal((await llamar({ ...guardar, id: nueva._id, token: nueva.token }, await signSession({ ...sesion, userId: String(supervisor._id) }))).status, 403);
    await Movimiento.create({ folio: "RET-ARQUEO", corte: "2026-09-09", cajaSesionId: caja._id, sucursalId: suc._id, usuarioId: user._id, monto: 10, moneda: "MXN", tipo: "retiro", motivo: "Prueba" });
    assert.equal((await llamar({ ...guardar, id: nueva._id, token: nueva.token })).status, 409);
    const caducada = await consultar();
    await Arqueo.updateOne({ _id: caducada._id }, { $set: { venceEn: new Date(0) } });
    assert.equal((await llamar({ ...guardar, id: caducada._id, token: caducada.token })).status, 409);
    const cerrada = await consultar();
    await Caja.updateOne({ _id: caja._id }, { estado: "cerrada" });
    assert.equal((await llamar({ ...guardar, id: cerrada._id, token: cerrada.token })).status, 409);
    await Caja.updateOne({ _id: caja._id }, { estado: "abierta" });
    await IntentoArqueo.updateOne({ _id: `${user._id}:${Math.floor(Date.now() / 60_000)}` }, { cantidad: 10 });
    assert.equal((await llamar({ accion: "consultar", nip: "654321" })).status, 429);
    console.log("OK: NIP, permisos, sucursal, token privado, conteos, MXN/USD, guardado único, caja abierta, historial, movimientos concurrentes, vencimiento y límite de intentos");
    if (process.argv.includes("--serve")) {
      await IntentoArqueo.deleteMany({});
      server = spawn("npm", ["run", "dev", "--", "--port", "3100"], { stdio: "inherit", env: { ...process.env } });
      await new Promise<void>((resolve) => { server!.on("exit", () => resolve()); process.on("SIGTERM", () => { server?.kill(); resolve(); }); });
    }
  } finally { server?.kill(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
