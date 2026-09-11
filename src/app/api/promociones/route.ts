import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, badRequest } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import { validarPromocion } from "@/lib/promociones";
import { validarSeleccionPromocion } from "@/lib/promocionesServidor";
import Promocion from "@/models/Promocion";
import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";

export async function GET(req: NextRequest) {
  const s = await requireSession(req);
  if (!s) return unauthorized();
  if (s.role !== "matriz" || !puede(s, "precios.actualizar")) return forbidden();
  await connectDB();
  const [promociones, productos, sucursales] = await Promise.all([
    Promocion.find().sort({ updatedAt: -1 }).lean(),
    Producto.find({ activo: true }).select("nombre sku categoria unidad").sort({ nombre: 1 }).lean(),
    Sucursal.find({ activo: true }).select("nombre").sort({ nombre: 1 }).lean(),
  ]);
  return NextResponse.json({ promociones, productos, sucursales });
}

export async function POST(req: NextRequest) {
  const s = await requireSession(req);
  if (!s) return unauthorized();
  if (s.role !== "matriz" || !puede(s, "precios.actualizar")) return forbidden();
  let datos;
  try { datos = validarPromocion(await req.json()); } catch (e) { return badRequest(e instanceof Error ? e.message : "Datos inválidos."); }
  await connectDB();
  try { await validarSeleccionPromocion(datos); } catch (e) { return badRequest(e instanceof Error ? e.message : "Selección inválida."); }
  const promocion = await Promocion.create({ ...datos, creadoPorId: s.userId, actualizadoPorId: s.userId, actualizadoPor: s.nombre });
  return NextResponse.json(promocion, { status: 201 });
}
