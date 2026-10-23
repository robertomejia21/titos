import { NextRequest, NextResponse } from "next/server";
import Vehiculo from "@/models/Vehiculo";
import Ruta from "@/models/Ruta";
import Sucursal from "@/models/Sucursal";
import { listarChoferes, sesionOperacion } from "@/lib/operacionApi";

/** Todo lo que necesita la pantalla de rutas para armar selectores. */
export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const [vehiculos, rutas, choferes, sucursales] = await Promise.all([
    Vehiculo.find().sort({ activo: -1, nombre: 1 }).lean(),
    Ruta.find().sort({ activo: -1, horaSalida: 1, orden: 1 }).lean(),
    listarChoferes(),
    Sucursal.find({ activo: true, esMatriz: { $ne: true } }).select("nombre clave").sort({ nombre: 1 }).lean(),
  ]);
  return NextResponse.json({ vehiculos, rutas, choferes, sucursales });
}
