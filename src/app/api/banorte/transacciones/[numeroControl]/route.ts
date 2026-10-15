import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import TransaccionBanorte from "@/models/TransaccionBanorte";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { ErrorBanorte, registrarRespuesta } from "@/lib/banorteServidor";
import { esNumeroControlValido } from "@/lib/banorte";

type Params = { params: Promise<{ numeroControl: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const { numeroControl } = await params;
  if (!esNumeroControlValido(numeroControl)) return badRequest("Número de control inválido");

  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();
  const transaccion = await TransaccionBanorte.findOne({ numeroControl, sucursalId: ctx.sucursalId }).lean();
  if (!transaccion) return notFound("La transacción no existe en esta tienda");
  return NextResponse.json(transaccion);
}

/** Registra lo que contestó el puente de caja (el comando, una verificación o una reversa). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const { numeroControl } = await params;
  if (!esNumeroControlValido(numeroControl)) return badRequest("Número de control inválido");
  const body = await req.json().catch(() => null);
  if (!body?.respuesta || typeof body.respuesta !== "object") return badRequest("Falta la respuesta de la terminal");

  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  try {
    const transaccion = await registrarRespuesta(ctx, numeroControl, body.respuesta);
    return NextResponse.json(transaccion);
  } catch (err) {
    if (err instanceof ErrorBanorte) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
