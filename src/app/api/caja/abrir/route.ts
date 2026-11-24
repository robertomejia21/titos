import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, badRequest, conflict } from "@/lib/apiAuth";
import { filtroCajaAbierta } from "@/lib/numeroCaja";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { obtenerConfiguracion } from "@/lib/configuracion";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);

  const efectivoInicialUsd = Number(body?.efectivoInicialUsd ?? 0);
  if (!Number.isFinite(efectivoInicialUsd) || efectivoInicialUsd < 0) {
    return badRequest("El fondo en dólares debe ser un monto válido");
  }

  const clienteOperacionId = body?.clienteOperacionId ? String(body.clienteOperacionId) : null;

  await connectDB();

  const ctx = await contextoPuntoVenta(session, req);
  if (!ctx) return forbidden();

  // Reintento de una apertura que el servidor ya había guardado (se cayó la red
  // antes de que llegara la respuesta): se devuelve la misma sesión.
  if (clienteOperacionId) {
    const yaAbierta = await CajaSesion.findOne({ clienteOperacionId });
    if (yaAbierta) return String(yaAbierta.sucursalId) === String(ctx.sucursalId) ? NextResponse.json(yaAbierta) : forbidden();
  }

  const config = await obtenerConfiguracion();
  const efectivoInicial = config.fondoCajaMxn ?? 1000;
  if (body?.efectivoInicial !== undefined && Number(body.efectivoInicial) !== efectivoInicial) {
    return NextResponse.json({ error: "El fondo lo define administración. Revisa el importe actualizado y vuelve a abrir la caja.", fondoCajaMxn: efectivoInicial }, { status: 409 });
  }

  const existente = await CajaSesion.findOne(filtroCajaAbierta(ctx));
  if (existente) return conflict(`La Caja ${ctx.numeroCaja} ya está abierta`);

  try {
    const sesion = await CajaSesion.create({
      sucursalId: ctx.sucursalId,
      numeroCaja: ctx.numeroCaja,
      ...(clienteOperacionId ? { clienteOperacionId } : {}),
      usuarioAperturaId: session.userId,
      fechaApertura: new Date(),
      efectivoInicial,
      efectivoInicialUsd,
    });
    return NextResponse.json(sesion, { status: 201 });
  } catch (err) {
    const codigo = (err as { code?: number }).code;
    if (codigo === 11000 && clienteOperacionId) {
      const ganadora = await CajaSesion.findOne({ clienteOperacionId });
      if (ganadora) return String(ganadora.sucursalId) === String(ctx.sucursalId) ? NextResponse.json(ganadora) : forbidden();
    }
    throw err;
  }
}
