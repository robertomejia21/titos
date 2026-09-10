import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { connectDB } from "../src/lib/db";
import { signSession } from "../src/lib/auth";
import { asegurarRolesSemilla } from "../src/lib/roles";
import { sesionVigente } from "../src/lib/sesionVigente";
import { accesoApiPuesto, accesoPaginaPuesto } from "../src/lib/accesoPuestos";
import { PUESTOS } from "../src/lib/puestos";
import { tienePermiso } from "../src/lib/permisos";
import { GET as sucursales } from "../src/app/api/sucursales/route";
import { GET as productos } from "../src/app/api/productos/route";
import { GET as ventas } from "../src/app/api/reportes/historial-ventas/route";
import { GET as usuarios, POST as crearUsuario } from "../src/app/api/usuarios/route";
import User from "../src/models/User";
import Rol from "../src/models/Rol";
import Sucursal from "../src/models/Sucursal";
import Producto from "../src/models/Producto";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("puestos_pruebas");
  process.env.JWT_SECRET = "puestos-solo-pruebas-2026";
  try {
    await connectDB();
    await asegurarRolesSemilla();
    await asegurarRolesSemilla();
    assert.equal(await Rol.countDocuments({ perfilDocumentoId: { $exists: true } }), 9);
    await Sucursal.create({ nombre: "Tienda prueba", direccion: "Privada" });
    await Producto.create({ sku: "TEST", nombre: "Prueba", categoria: "Prueba", unidad: "pieza", precioCompra: 5, precioVenta: 10 });
    const admin = await User.create({ nombre: "Admin", email: "admin@prueba.local", role: "matriz", passwordHash: "no-login" });
    const adminToken = await signSession({ userId: String(admin._id), nombre: admin.nombre, email: admin.email, role: "matriz", sucursalId: null });
    const req = (path: string, token: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${path}`, { method, headers: { cookie: `titos_session=${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const p of PUESTOS) {
      const rol = await Rol.findOne({ perfilDocumentoId: p.perfilDocumentoId });
      const user = await User.create({ nombre: p.nombre, email: `${p.perfilDocumentoId}@prueba.local`, role: p.ambito, rolId: rol._id, passwordHash: "no-login" });
      const claims = { userId: String(user._id), nombre: user.nombre, email: user.email, role: p.ambito, sucursalId: null };
      const session = (await sesionVigente(claims))!;
      assert.deepEqual(session.permisos, p.permisos);
      assert.equal(session.perfilDocumentoId, p.perfilDocumentoId);
      assert.equal(accesoApiPuesto(session, "/api/usuarios", "POST"), p.perfilDocumentoId === "web-administrador");
      assert.equal(accesoApiPuesto(session, "/api/configuracion", "PATCH"), p.perfilDocumentoId === "web-administrador");
      assert.equal(accesoApiPuesto(session, "/api/desconocido", "POST"), false);
      const token = await signSession(claims);
      if (p.perfilDocumentoId !== "web-administrador") assert.equal((await usuarios(req("/api/usuarios", token))).status, 401);
      if (tienePermiso(session, "reportes.productos")) {
        const response = await sucursales(req("/api/sucursales", token));
        assert.equal(response.status, 200);
        if (p.perfilDocumentoId !== "web-administrador") assert.deepEqual(Object.keys((await response.json())[0]).sort(), ["_id", "nombre"]);
      }
      if (tienePermiso(session, "reportes.ventas")) assert.equal((await ventas(req("/api/reportes/historial-ventas", token))).status, 200);
      if (p.perfilDocumentoId === "web-almacenista") {
        const response = await productos(req("/api/productos", token));
        assert.equal(response.status, 200);
        assert.equal("precioCompra" in (await response.json())[0], false);
        assert.equal(accesoPaginaPuesto(session, "/matriz/reportes/ventas"), false);
      }
      if (p.perfilDocumentoId === "web-compras") {
        const alta = await crearUsuario(req("/api/usuarios", adminToken, "POST", { nombre: "Compras nueva", email: "nueva@prueba.local", role: "matriz", rolId: String(rol._id), password: "Pruebas-locales-2026" }));
        assert.equal(alta.status, 201, await alta.clone().text());
        assert.equal(accesoApiPuesto(session, "/api/ordenes-compra", "POST"), false);
        await Rol.updateOne({ _id: rol._id }, { $set: { permisos: [] } });
        const sinPermisos = (await sesionVigente({ ...claims, permisos: ["usuarios.administrar"] }))!;
        assert.equal(tienePermiso(sinPermisos, "usuarios.administrar"), false);
        await asegurarRolesSemilla();
        assert.deepEqual((await Rol.findById(rol._id)).permisos, []);
        await Rol.updateOne({ _id: rol._id }, { $set: { activo: false } });
        assert.equal(accesoPaginaPuesto((await sesionVigente(claims))!, "/matriz/productos"), false);
      }
    }
    console.log("OK: nueve puestos, alta con rol/NIP, permisos reales, bloqueo de API, reportes, privacidad y revocación de sesiones.");
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
