import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Devolucion from "@/models/Devolucion";
import CajaSesion from "@/models/CajaSesion";
import TransaccionBanorte from "@/models/TransaccionBanorte";
import { requireSession, unauthorized, forbidden, badRequest, notFound, conflict, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { redondear, zonaHorariaDeSucursal } from "@/lib/credito";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { esNumeroControlValido } from "@/lib/banorte";

/**
 * Cierra la parte "a tarjeta" de una devolución:
 * - `{ numeroControl }`: la DEVOLUCION que aprobó Banorte para esta devolución.
 * - `{ convertirEfectivo: true }`: Banorte no la aplicó (o no hay terminal) y
 *   ese monto se le paga al cliente en efectivo.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "devoluciones.registrar")) return sinPermiso("devoluciones.registrar");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const devolucion = await Devolucion.findById(id).catch(() => null);
  if (!devolucion || String(devolucion.sucursalId) !== String(ctx.sucursalId)) return notFound("Devolución no encontrada");
  if (!devolucion.tarjeta || devolucion.tarjeta.estado !== "pendiente") {
    return conflict("Esta devolución no tiene un reembolso a tarjeta pendiente");
  }

  if (body.numeroControl) {
    if (!esNumeroControlValido(body.numeroControl)) return badRequest("Número de control inválido");
    const tx = await TransaccionBanorte.findOne({ numeroControl: body.numeroControl, sucursalId: ctx.sucursalId });
    if (
      !tx ||
      tx.comando !== "DEVOLUCION" ||
      tx.estado !== "aprobada" ||
      String(tx.transaccionOriginalId) !== String(devolucion.tarjeta.transaccionOriginalId) ||
      Math.abs((tx.monto ?? 0) - (devolucion.montoTarjeta ?? 0)) > 0.005
    ) {
      return badRequest("La devolución en la terminal no corresponde a esta devolución o no está aprobada");
    }
    if (tx.aplicada) return conflict("Esa devolución de la terminal ya se usó");
    tx.aplicada = true;
    tx.devolucionId = devolucion._id;
    await tx.save();
    devolucion.tarjeta.estado = "aprobada";
    devolucion.tarjeta.numeroControl = tx.numeroControl;
    devolucion.tarjeta.referencia = tx.referencia ?? "";
    devolucion.tarjeta.autorizacion = tx.autorizacion ?? "";
    await devolucion.save();
    return NextResponse.json(devolucion);
  }

  if (body.convertirEfectivo === true) {
    devolucion.montoEfectivo = redondear((devolucion.montoEfectivo ?? 0) + (devolucion.montoTarjeta ?? 0));
    devolucion.montoTarjeta = 0;
    devolucion.tarjeta.estado = "convertida_efectivo";
    // El efectivo solo sale de una caja abierta: si no hay, queda pendiente
    // de pago como cualquier devolución.
    const sesionCaja = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" });
    if (sesionCaja) {
      devolucion.estado = "pagada";
      devolucion.cajaSesionId = sesionCaja._id;
      devolucion.cortePago = todayCorte(await zonaHorariaDeSucursal(ctx.sucursalId));
      devolucion.pagadaEn = new Date();
      devolucion.pagadaPorId = session.userId;
    } else {
      devolucion.estado = "pendiente";
      devolucion.cajaSesionId = null;
      devolucion.cortePago = null;
      devolucion.pagadaEn = null;
      devolucion.pagadaPorId = null;
    }
    await devolucion.save();
    return NextResponse.json(devolucion);
  }

  return badRequest("Indica el número de control de la devolución en la terminal o convertirEfectivo");
}
