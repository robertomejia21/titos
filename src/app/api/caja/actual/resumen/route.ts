import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, notFound } from "@/lib/apiAuth";
import { calcularResumenSesion, calcularEfectivoEsperado, calcularEfectivoEsperadoUsd } from "@/lib/caja";
import { filtroCajaAbierta } from "@/lib/numeroCaja";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const ctx = await contextoPuntoVenta(session, req);
  if (!ctx) return forbidden();

  const sesion = await CajaSesion.findOne(filtroCajaAbierta(ctx)).lean();
  if (!sesion) return notFound("No tienes una caja abierta");

  const resumen = await calcularResumenSesion(String(sesion._id));
  const efectivoEsperado = calcularEfectivoEsperado(sesion.efectivoInicial, resumen);
  const efectivoEsperadoUsd = calcularEfectivoEsperadoUsd(sesion.efectivoInicialUsd ?? 0, resumen);

  return NextResponse.json({ sesion, ...resumen, efectivoEsperado, efectivoEsperadoUsd });
}
