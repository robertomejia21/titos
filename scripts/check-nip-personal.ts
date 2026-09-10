import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { connectDB } from "../src/lib/db";
import { hashPassword, signSession, verifyPassword } from "../src/lib/auth";
import { POST, GET } from "../src/app/api/usuarios/route";
import { PATCH } from "../src/app/api/usuarios/[id]/route";
import { prepararNipPersonal } from "../src/lib/nipPersonal";
import { PERFILES_DOCUMENTO } from "../src/lib/perfilesDocumento";
import { buscarSupervisorPorNip } from "../src/lib/supervisores";
import { requiereNipCaja } from "../src/lib/nipCaja";
import User from "../src/models/User";
import Rol from "../src/models/Rol";

async function main() {
  assert.equal(requiereNipCaja({ perfilDocumentoId: "pos-cajero" }), true);
  assert.equal(requiereNipCaja({ nombre: "Supervisor", esSupervisor: true }), true);
  assert.equal(requiereNipCaja({ nombre: "Compras" }), false);
  assert.equal(requiereNipCaja({ nombre: "Administrador de sucursal" }), false);
  assert.equal(requiereNipCaja(null, { role: "sucursal", sucursalRol: "ventas" }), true);
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_nip_personal_pruebas");
  process.env.JWT_SECRET = "solo-pruebas-nip-personal-2026";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    const admin = await User.create({ nombre: "Admin prueba", email: "pruebas@titos.local", role: "matriz", passwordHash: await hashPassword("Pruebas-locales-2026") });
    const rol = await Rol.create({ nombre: "Caja", ambito: "matriz", permisos: ["pos.vender"], esSupervisor: false });
    const token = await signSession({ userId: String(admin._id), email: admin.email, nombre: admin.nombre, role: "matriz", sucursalId: null });
    const request = (method: string, body?: unknown, auth = token) => new NextRequest("http://localhost/api/usuarios", {
      method, headers: { cookie: `titos_session=${auth}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const datos = { nombre: "Persona prueba", email: "persona@titos.local", role: "matriz", rolId: String(rol._id), password: "Pruebas-locales-2026", nipOperacion: "123456" };
    assert.equal((await POST(request("POST", datos, ""))).status, 401);
    assert.equal((await POST(request("POST", { ...datos, nipOperacion: "" }))).status, 400);
    const alta = await POST(request("POST", datos));
    assert.equal(alta.status, 201, await alta.clone().text());
    const { _id: id } = await alta.json();
    assert.equal((await POST(request("POST", { ...datos, email: "otra@titos.local" }))).status, 400);
    assert.equal(await buscarSupervisorPorNip("123456"), null, "Tener NIP no convierte al usuario en supervisor");
    assert.equal((await PATCH(request("PATCH", { nipOperacion: "123456" }), { params: Promise.resolve({ id }) })).status, 200);
    assert.equal((await PATCH(request("PATCH", { nipOperacion: null }), { params: Promise.resolve({ id }) })).status, 200);
    await User.create({ nombre: "NIP anterior", email: "anterior@titos.local", role: "matriz", passwordHash: "no-login", nipOperacionHash: await hashPassword("654321"), activo: false });
    assert.equal((await PATCH(request("PATCH", { nipOperacion: "654321" }), { params: Promise.resolve({ id }) })).status, 400, "También protege NIP anteriores e inactivos");
    const preparados = await Promise.all([prepararNipPersonal("333333"), prepararNipPersonal("333333")]);
    const concurrentes = await Promise.allSettled(preparados.map((nip, i) => User.create({ ...nip, nombre: "Alta concurrente", email: `concurrente${i}@titos.local`, role: "matriz", passwordHash: "no-login" })));
    assert.equal(concurrentes.filter((r) => r.status === "fulfilled").length, 1, "El índice resuelve la carrera entre dos altas");
    const anterior = (await User.findById(id)).nipOperacionHash;
    assert.equal((await PATCH(request("PATCH", { nipOperacion: "" }), { params: Promise.resolve({ id }) })).status, 200);
    assert.equal((await User.findById(id)).nipOperacionHash, anterior);
    assert.equal((await PATCH(request("PATCH", { nipOperacion: "918273" }), { params: Promise.resolve({ id }) })).status, 200);
    const cambiado = (await User.findById(id)).nipOperacionHash;
    assert.equal(await verifyPassword("918273", cambiado), true);
    assert.equal(await verifyPassword("123456", cambiado), false);
    const administrativo = await Rol.create({ nombre: "Contabilidad prueba", ambito: "matriz", permisos: ["pos.vender"], esSupervisor: false });
    const sinNip = { ...datos, email: "admin-sin-nip@titos.local", rolId: String(administrativo._id), nipOperacion: "" };
    const altaSinNip = await POST(request("POST", sinNip));
    assert.equal(altaSinNip.status, 201);
    const idSinNip = (await altaSinNip.json())._id;
    assert.equal(!!(await User.findById(idSinNip)).nipOperacionHash, false);
    assert.equal((await PATCH(request("PATCH", { nombre: "Administrativo editado" }), { params: Promise.resolve({ id: idSinNip }) })).status, 200);
    assert.equal((await PATCH(request("PATCH", { nipOperacion: "384756" }), { params: Promise.resolve({ id: idSinNip }) })).status, 400);
    assert.equal((await PATCH(request("PATCH", { rolId: String(rol._id) }), { params: Promise.resolve({ id: idSinNip }) })).status, 400);
    const listado = await (await GET(request("GET"))).json();
    assert.equal(JSON.stringify(listado).includes("nipOperacionHash"), false);
    assert.equal(JSON.stringify(listado).includes("nipOperacionHuella"), false);
    assert.equal(listado.usuarios.find((u: { _id: string }) => u._id === id).tieneNipOperacion, true);
    assert.equal((await PATCH(request("PATCH", { nombre: "Admin actualizado" }), { params: Promise.resolve({ id: String(admin._id) }) })).status, 200);
    assert.deepEqual(PERFILES_DOCUMENTO.map((p) => p.pagina), [1,2,3,4,5,6,7,8,9]);
    console.log("OK: NIP personal de operador, validación, duplicados heredados, concurrencia, edición, privacidad y nueve páginas del PDF");
    if (process.argv.includes("--serve")) {
      server = spawn("npm", ["run", "dev", "--", "--port", "3100"], { stdio: "inherit", env: { ...process.env } });
      await new Promise<void>((resolve) => { server!.on("exit", () => resolve()); process.on("SIGTERM", () => { server?.kill(); resolve(); }); });
    }
  } finally { server?.kill(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
