import { NextRequest, NextResponse } from "next/server";
import { filtroCajaAbierta } from "@/lib/numeroCaja";
import { connectDB } from "@/lib/db";
import Devolucion from "@/models/Devolucion";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, badRequest, notFound, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

/** Paga una devolución que quedó pendiente porque el corte de su día ya estaba cerrado. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "devoluciones.registrar")) return sinPermiso("devoluciones.registrar");
  const { id } = await params;
  await connectDB();

  const ctx = await contextoPuntoVenta(session, req);
  if (!ctx) return forbidden();

  const devolucion = await Devolucion.findById(id);
  if (!devolucion || String(devolucion.sucursalId) !== String(ctx.sucursalId)) {
    return notFound("Devolución no encontrada");
  }
  if (devolucion.estado !== "pendiente") return badRequest("Esta devolución ya no está pendiente de pago");

  const sesionCaja = await CajaSesion.findOne(filtroCajaAbierta(ctx));
  if (!sesionCaja) return badRequest("Debes abrir la caja para poder pagar la devolución");

  devolucion.estado = "pagada";
  devolucion.cajaSesionId = sesionCaja._id;
  devolucion.cortePago = todayCorte(await zonaHorariaDeSucursal(ctx.sucursalId));
  devolucion.pagadaEn = new Date();
  devolucion.pagadaPorId = session.userId;
  await devolucion.save();

  return NextResponse.json(devolucion);
}
