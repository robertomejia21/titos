// Diagnóstico de SOLO LECTURA para preparar las capturas de la presentación:
// qué cuentas hay, si el mostrador tiene caja abierta y si hay datos que
// fotografiar. No escribe nada.
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import Sucursal from "@/models/Sucursal";
import CajaSesion from "@/models/CajaSesion";
import Producto from "@/models/Producto";
import Venta from "@/models/Venta";
import RolModel from "@/models/Rol";
import TerminalPago from "@/models/TerminalPago";
import AlertaInventarioCero from "@/models/AlertaInventarioCero";

async function main() {
  await connectDB();

  const sucursales = await Sucursal.find({}).select("nombre esMatriz activo").lean();
  console.log("Sucursales:");
  for (const s of sucursales) {
    console.log(`  ${s.nombre}${s.esMatriz ? " (mostrador matriz)" : ""}${s.activo ? "" : " [inactiva]"} — ${s._id}`);
  }

  console.log("\nUsuarios:");
  const usuarios = await UserModel.find({}).select("nombre email role sucursalId activo").lean();
  for (const u of usuarios) {
    console.log(`  ${u.role.padEnd(9)} ${u.email}${u.activo ? "" : " [inactivo]"}`);
  }

  console.log("\nCajas abiertas:");
  const cajas = await CajaSesion.find({ estado: "abierta" }).select("sucursalId fechaApertura").lean();
  if (cajas.length === 0) console.log("  ninguna");
  for (const c of cajas) {
    const s = sucursales.find((x) => String(x._id) === String(c.sucursalId));
    console.log(`  ${s?.nombre ?? c.sucursalId} — abierta desde ${c.fechaApertura}`);
  }

  const productos = await Producto.countDocuments({ activo: true });
  const conStock = await Producto.countDocuments({ activo: true, existenciaMatriz: { $gt: 0 } });
  const ventas = await Venta.countDocuments({});
  const terminales = await TerminalPago.countDocuments({ activo: true });
  const alertas = await AlertaInventarioCero.countDocuments({});
  const roles = await RolModel.find({}).select("nombre esSupervisor").lean();

  console.log(`\nProductos activos: ${productos} (con existencia en matriz: ${conStock})`);
  console.log(`Ventas registradas: ${ventas}`);
  console.log(`Terminales activas: ${terminales}`);
  console.log(`Alertas de inventario en cero: ${alertas}`);
  console.log(`Roles: ${roles.map((r) => `${r.nombre}${r.esSupervisor ? " *supervisor" : ""}`).join(", ")}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
