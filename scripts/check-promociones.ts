import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { connectDB } from "../src/lib/db";
import { hashPassword, signSession } from "../src/lib/auth";
import { POST, GET } from "../src/app/api/promociones/route";
import { PATCH } from "../src/app/api/promociones/[id]/route";
import { validarPromocion } from "../src/lib/promociones";
import User from "../src/models/User";
import Rol from "../src/models/Rol";
import Producto from "../src/models/Producto";
import Sucursal from "../src/models/Sucursal";
import Promocion from "../src/models/Promocion";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_promociones_pruebas");
  process.env.JWT_SECRET = "solo-pruebas-promociones-2026";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    const admin = await User.create({ nombre: "Administración de prueba", email: "pruebas@titos.local", role: "matriz", passwordHash: await hashPassword("Pruebas-locales-2026") });
    const sucursal = await Sucursal.create({ nombre: "Sucursal de prueba", clave: "PRUEBA" });
    const producto = await Producto.create({ nombre: "Manzana de prueba", sku: "PR-001", categoria: "Frutas", unidad: "kg", precioVenta: 40 });
    const pieza = await Producto.create({ nombre: "Leche de prueba", sku: "PR-002", categoria: "Lácteos", unidad: "pieza", precioVenta: 30 });
    const restrictedRole = await Rol.create({ nombre: "Consulta prueba", ambito: "matriz", permisos: ["reportes.productos"] });
    const restricted = await User.create({ nombre: "Consulta", email: "consulta@titos.local", role: "matriz", rolId: restrictedRole._id, passwordHash: "no-login" });
    const cashier = await User.create({ nombre: "Caja", email: "caja@titos.local", role: "sucursal", sucursalId: sucursal._id, sucursalRol: "ventas", passwordHash: "no-login" });
    const auth = async (u: typeof admin) => signSession({ userId: String(u._id), email: u.email, nombre: u.nombre, role: u.role, sucursalId: u.sucursalId ? String(u.sucursalId) : null });
    const token = await auth(admin);
    const req = (method: string, body?: unknown, cookie = token) => new NextRequest("http://localhost/api/promociones", { method, headers: { cookie: `titos_session=${cookie}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const base = { nombre: "Fin de semana de prueba", tipo: "porcentaje", valor: 10, alcance: "productos", productos: [String(producto._id)], categorias: [], sucursales: [String(sucursal._id)], unidad: "kg", inicio: "2026-09-18", fin: "2026-09-20", estado: "borrador" };
    assert.equal((await GET(req("GET", undefined, ""))).status, 401);
    for (const user of [restricted, cashier]) {
      const t = await auth(user);
      assert.equal((await GET(req("GET", undefined, t))).status, 403);
      assert.equal((await POST(req("POST", base, t))).status, 403);
    }
    for (const changes of [{ valor: 101 }, { valor: -1 }, { valor: "10" }, { valor: 0.001 }, { inicio: "2026-02-30" }, { fin: "2026-09-01" }, { estado: "activo" }, { productos: [] }, { sucursales: [] }, { productos: ["bad-id"] }]) {
      assert.throws(() => validarPromocion({ ...base, ...changes }));
      assert.equal((await POST(req("POST", { ...base, ...changes }))).status, 400);
    }
    assert.equal((await POST(req("POST", { ...base, productos: [String(pieza._id)] }))).status, 400, "No permite mezclar piezas con solo kilos");
    assert.equal((await POST(req("POST", { ...base, sucursales: [new mongoose.Types.ObjectId().toString()] }))).status, 400);
    assert.equal((await POST(req("POST", { ...base, alcance: "categorias", categorias: ["Inexistente"] }))).status, 400);
    const alta = await POST(req("POST", base));
    assert.equal(alta.status, 201, await alta.clone().text());
    const saved = await alta.json();
    const ctx = { params: Promise.resolve({ id: saved._id }) };
    assert.equal((await PATCH(req("PATCH", { ...base, revision: 0, valor: 15 }), ctx)).status, 200);
    assert.equal((await PATCH(req("PATCH", { ...base, revision: 0, valor: 20 }), ctx)).status, 409, "Impide sobrescribir una edición concurrente");
    assert.equal((await PATCH(req("PATCH", { ...base, revision: 1, estado: "activo" }), ctx)).status, 400);
    const categories = await POST(req("POST", { ...base, nombre: "Lácteos de prueba", alcance: "categorias", productos: [], categorias: ["Lácteos"], unidad: "pieza", tipo: "monto", valor: 5 }));
    assert.equal(categories.status, 201);
    await Producto.updateOne({ _id: producto._id }, { activo: false });
    assert.equal((await PATCH(req("PATCH", { ...base, revision: 1 }), ctx)).status, 400);
    assert.equal((await PATCH(req("PATCH", { ...base, revision: 1, estado: "archivado" }), ctx)).status, 200);
    const listado = await (await GET(req("GET"))).json();
    assert.equal(listado.promociones.length, 2);
    assert.equal((await Producto.findById(producto._id)).precioVenta, 40, "Los borradores no cambian precios");
    assert.equal(await Promocion.countDocuments({ estado: "activo" }), 0);
    await Producto.updateOne({ _id: producto._id }, { activo: true });
    console.log("OK: acceso, fechas, importes, selecciones, unidades, edición concurrente, archivo y borradores sin cambios en precios.");
    if (process.argv.includes("--serve")) {
      server = spawn("npm", ["run", "dev", "--", "--port", "3100"], { stdio: "inherit", env: { ...process.env } });
      await new Promise<void>((resolve) => { server!.on("exit", () => resolve()); process.on("SIGTERM", () => { server?.kill(); resolve(); }); });
    }
  } finally { server?.kill(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
