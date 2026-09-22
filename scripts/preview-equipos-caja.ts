import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { connectDB } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { EQUIPO_VACIO } from "../src/lib/equiposCaja";
import User from "../src/models/User";
import Sucursal from "../src/models/Sucursal";
import TerminalPago from "../src/models/TerminalPago";
import EquipoCaja from "../src/models/EquipoCaja";
import Producto from "../src/models/Producto";
import InventarioSucursal from "../src/models/InventarioSucursal";
import CajaSesion from "../src/models/CajaSesion";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("equipos_preview_aislada");
  process.env.JWT_SECRET = "equipos-preview-local-no-produccion";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    const passwordHash = await hashPassword("Prueba-local-2026");
    await User.create({ nombre: "Administración · PRUEBA", email: "admin@prueba.local", passwordHash, role: "matriz" });
    const junior = await Sucursal.create({ nombre: "Junior · PRUEBA" });
    await Sucursal.create({ nombre: "Otra tienda · PRUEBA" });
    const caja = await User.create({ nombre: "Caja Junior · PRUEBA", email: "caja@prueba.local", passwordHash, role: "sucursal", sucursalId: junior._id, permisosIndividuales: ["pos.vender", "ventas.historial"] });
    const terminal = await TerminalPago.create({ sucursalId: junior._id, alias: "Banorte · PRUEBA", banco: "Banorte" });
    await EquipoCaja.create({ sucursalId: junior._id, actualizadoPor: "Datos de prueba", configuracion: { ...EQUIPO_VACIO, nombreCaja: "Junior · PRUEBA", marcaBascula: "PSC", terminalId: String(terminal._id), exigirAutorizacion: true } });
    const producto = await Producto.create({ sku: "PESO-QA", nombre: "Producto por kilo · PRUEBA", categoria: "Prueba", unidad: "kg", requierePesaje: true, precioVenta: 80 });
    await InventarioSucursal.create({ sucursalId: junior._id, productoId: producto._id, stockActual: 100 });
    await CajaSesion.create({ sucursalId: junior._id, usuarioAperturaId: caja._id, efectivoInicial: 100 });
    server = spawn("npm", ["run", "dev", "--", "--port", "3100"], { stdio: "inherit", env: process.env });
    await new Promise<void>(resolve => {
      server!.on("exit", resolve);
      for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { server?.kill(); resolve(); });
    });
  } finally { server?.kill(); await mongoose.disconnect(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
