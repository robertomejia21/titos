import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Producto from "@/models/Producto";
import { requireSession, unauthorized, puede } from "@/lib/apiAuth";
import { regexBusqueda } from "@/lib/busqueda";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const permiso = session.role === "matriz" ? "productos.administrar" : "pos.vender";
  if (!puede(session, permiso)) return NextResponse.json({ productos: [] });
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (q.length < 2) return NextResponse.json({ productos: [] });
  await connectDB();
  const productos = await Producto.find({ activo: true, $and: q.split(/\s+/).map((palabra) => {
    const regex = regexBusqueda(palabra);
    return { $or: [{ nombre: regex }, { sku: regex }, { alias: regex }] };
  }) }).select("nombre sku").sort({ nombre: 1, _id: 1 }).limit(8).lean();
  return NextResponse.json({ productos: productos.map((p) => ({
    label: p.nombre, grupo: `Producto · ${p.sku}`,
    href: `/${session.role}/productos?q=${encodeURIComponent(p.sku)}`,
  })) });
}
