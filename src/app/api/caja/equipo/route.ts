import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { normalizarNumeroCaja } from "@/lib/numeroCaja";
import { buscarSupervisorPorNip } from "@/lib/supervisores";
import {
  ErrorAsignacionCaja,
  asignarCajaAComputadora,
  cajasDeSucursal,
  ponerCookieComputadora,
} from "@/lib/cajaComputadora";

/** Qué caja es esta computadora y qué cajas tiene la sucursal. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();
  return NextResponse.json(await cajasDeSucursal(req, ctx.sucursalId));
}

/**
 * Marca esta computadora como la caja `numeroCaja`. Si esa caja ya es de otra
 * computadora, hace falta el NIP del gerente de tienda (reemplazo de equipo).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pos.vender")) return sinPermiso("pos.vender");

  const body = await req.json().catch(() => null);
  const numeroCaja = normalizarNumeroCaja(body?.numeroCaja);
  if (!numeroCaja) return badRequest("Elige un número de caja válido");
  const nip = String(body?.nipSupervisor ?? "").trim();

  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  let asignadaPor = session.nombre;
  if (nip) {
    const gerente = await buscarSupervisorPorNip(nip, ctx.sucursalId);
    if (!gerente) return badRequest("NIP del gerente incorrecto");
    asignadaPor = `${session.nombre} (autorizó ${gerente.nombre})`;
  }

  try {
    const { computadoraId } = await asignarCajaAComputadora({
      req,
      sucursalId: ctx.sucursalId,
      numeroCaja,
      asignadaPor,
      reemplazo: !!nip,
    });
    const res = NextResponse.json({ numeroCaja });
    ponerCookieComputadora(res, computadoraId);
    return res;
  } catch (err) {
    if (err instanceof ErrorAsignacionCaja) {
      return NextResponse.json({ error: err.message, ocupada: true }, { status: err.status });
    }
    throw err;
  }
}
