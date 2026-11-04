import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import Empleado from "@/models/Empleado";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { idONull } from "@/lib/operacionApi";
import { evento } from "@/lib/logistica";
import { cargarPedidoMatriz, POBLAR_PEDIDO, respuestaPedido } from "@/lib/cajasPedido";
import { puedeVerMontosTraspasos, sinMontos } from "@/lib/montosTraspasos";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const { id } = await params;
  await connectDB();

  const pedido = await Pedido.findById(id).populate(POBLAR_PEDIDO).lean();
  if (!pedido) return notFound("Pedido no encontrado");

  if (session.role === "sucursal" && String(pedido.sucursalId?._id ?? pedido.sucursalId) !== session.sucursalId) {
    return forbidden();
  }

  return NextResponse.json((await puedeVerMontosTraspasos(session)) ? pedido : sinMontos(pedido));
}

/** Asigna al surtidor del CEDIS (el chofer se confirma en el rol, al salir). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { pedido, session, error } = await cargarPedidoMatriz(req, id);
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || !("surtidorId" in body)) return badRequest("No hay cambios para aplicar");
  const surtidorId = idONull(body.surtidorId);
  if (body.surtidorId && !surtidorId) return badRequest("Surtidor inválido");
  const surtidor = surtidorId ? await Empleado.findById(surtidorId).select("nombre").lean() : null;
  if (surtidorId && !surtidor) return badRequest("Ese surtidor ya no existe en Personal");
  if (pedido.estado === "recibido") return badRequest("El pedido ya se recibió en tienda");

  pedido.surtidorId = surtidorId;
  pedido.historial.push(evento(session, "surtidor", surtidor?.nombre ?? "Sin surtidor"));
  await pedido.save();

  return NextResponse.json(await respuestaPedido(pedido._id, session));
}
