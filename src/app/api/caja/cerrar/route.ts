import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, badRequest } from "@/lib/apiAuth";
import { calcularResumenSesion, calcularEfectivoEsperado, calcularEfectivoEsperadoUsd } from "@/lib/caja";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const efectivoContado = Number(body?.efectivoContado);
  const efectivoContadoUsd = Number(body?.efectivoContadoUsd ?? 0);
  const notas = String(body?.notas ?? "").trim();

  if (!Number.isFinite(efectivoContado) || efectivoContado < 0) {
    return badRequest("Captura el efectivo contado para cerrar la caja");
  }
  if (!Number.isFinite(efectivoContadoUsd) || efectivoContadoUsd < 0) {
    return badRequest("Los dólares contados deben ser un monto válido");
  }

  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const sesion = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" });
  if (!sesion) return badRequest("No tienes una caja abierta");

  const resumen = await calcularResumenSesion(String(sesion._id));
  const efectivoEsperado = calcularEfectivoEsperado(sesion.efectivoInicial, resumen);
  const efectivoEsperadoUsd = calcularEfectivoEsperadoUsd(sesion.efectivoInicialUsd ?? 0, resumen);

  sesion.estado = "cerrada";
  sesion.usuarioCierreId = session.userId;
  sesion.fechaCierre = new Date();
  sesion.totalVentasEfectivo = resumen.totalVentasEfectivo;
  sesion.totalVentasTarjeta = resumen.totalVentasTarjeta;
  sesion.totalVentasTransferencia = resumen.totalVentasTransferencia;
  sesion.totalVentasVales = resumen.totalVentasVales;
  sesion.tarjetaPorTerminal = resumen.tarjetaPorTerminal;
  sesion.tarjetaPorTipo = resumen.tarjetaPorTipo;
  sesion.valesPorEmisor = resumen.valesPorEmisor;
  sesion.totalVentasDolaresUsd = resumen.totalVentasDolaresUsd;
  sesion.totalVentasDolaresMxn = resumen.totalVentasDolaresMxn;
  sesion.totalCambioDolaresMxn = resumen.totalCambioDolaresMxn;
  sesion.totalVentasCredito = resumen.totalVentasCredito;
  sesion.totalAbonosEfectivo = resumen.totalAbonosEfectivo;
  sesion.totalDevoluciones = resumen.totalDevoluciones;
  sesion.totalRetiros = resumen.totalRetiros;
  sesion.efectivoEsperado = efectivoEsperado;
  sesion.efectivoContado = efectivoContado;
  sesion.diferencia = Number((efectivoContado - efectivoEsperado).toFixed(2));
  sesion.totalRetirosUsd = resumen.totalRetirosUsd;
  sesion.efectivoEsperadoUsd = efectivoEsperadoUsd;
  sesion.efectivoContadoUsd = efectivoContadoUsd;
  sesion.diferenciaUsd = Number((efectivoContadoUsd - efectivoEsperadoUsd).toFixed(2));
  sesion.notas = notas;

  await sesion.save();

  return NextResponse.json(sesion);
}
