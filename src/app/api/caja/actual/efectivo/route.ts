import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";
import { calcularResumenSesion, calcularEfectivoEsperado, estadoLimiteEfectivo } from "@/lib/caja";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

/**
 * Efectivo en pesos que debería haber en el cajón abierto y si ya pasó el
 * límite de efectivo. El punto de venta lo consulta después de cada cobro para
 * abrir solo el aviso de retiro parcial.
 *
 * Es más ligero que /resumen en lo que regresa (no manda el desglose del
 * corte), porque se pregunta muchas veces durante el turno.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const sesion = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" })
    .select("_id efectivoInicial")
    .lean<{ _id: unknown; efectivoInicial: number } | null>();
  if (!sesion) return NextResponse.json({ abierta: false });

  const [resumen, config] = await Promise.all([calcularResumenSesion(String(sesion._id)), obtenerConfiguracion()]);
  const efectivoEnCaja = calcularEfectivoEsperado(sesion.efectivoInicial, resumen);
  const fondo = sesion.efectivoInicial ?? 0;
  const limite = config.limiteEfectivoCajaMxn ?? 2000;

  return NextResponse.json({
    abierta: true,
    cajaSesionId: String(sesion._id),
    fondo,
    efectivoEnCaja,
    ...estadoLimiteEfectivo(efectivoEnCaja, fondo, limite),
  });
}
