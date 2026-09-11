import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import Promocion from "@/models/Promocion";
export async function GET(req: NextRequest) {
  const s = await requireSession(req);
  if (!s) return unauthorized();
  if (!puede(s, "pos.vender")) return forbidden();
  await connectDB();
  const ctx = await contextoPuntoVenta(s);
  if (!ctx) return forbidden();
  return NextResponse.json(await Promocion.find({ estado: "activa", sucursales: ctx.sucursalId }).select("nombre tipo valor alcance productos categorias areas unidad inicio fin estado lleva bonifica porcentajeBeneficio combinada prioridad").lean(), { headers: { "Cache-Control": "no-store" } });
}
