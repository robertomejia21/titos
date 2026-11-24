import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import "@/models/User"; // necesario para que populate("usuarioAperturaId") funcione
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";
import { filtroCajaAbierta } from "@/lib/numeroCaja";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const ctx = await contextoPuntoVenta(session, req);
  if (!ctx) return forbidden();

  const sesion = await CajaSesion.findOne(filtroCajaAbierta(ctx))
    .populate("usuarioAperturaId", "nombre")
    .lean();

  return NextResponse.json(sesion ?? null);
}
