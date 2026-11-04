import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Incidencia from "@/models/Incidencia";
import Pedido from "@/models/Pedido";
import { badRequest, forbidden, notFound } from "@/lib/apiAuth";
import { evento, TIPO_INCIDENCIA_LABEL, type TipoIncidencia } from "@/lib/logistica";
import { filtroDeSesion, sesionIncidencias, vistasIncidencias } from "@/lib/incidencias";

/**
 * Agrega un comentario (CEDIS o la tienda involucrada) o la marca resuelta
 * (solo el CEDIS, con lo que se hizo). Los comentarios nunca se borran.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await sesionIncidencias(req);
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Incidencia no encontrada");
  const incidencia = await Incidencia.findOne({ _id: id, ...filtroDeSesion(session) });
  if (!incidencia) return notFound("Incidencia no encontrada");

  const body = await req.json().catch(() => null);
  const texto = String(body?.comentario ?? "").trim().slice(0, 1000);

  if (body?.resolver === true) {
    if (session.role !== "matriz") return forbidden();
    if (incidencia.estado === "resuelta") return badRequest("La incidencia ya está resuelta");
    if (!texto) return badRequest("Escribe cómo se resolvió (por ejemplo, reenvío a la sucursal correcta)");
    incidencia.estado = "resuelta";
    incidencia.resueltaEn = new Date();
    incidencia.resueltaPorNombre = session.nombre ?? "";
    incidencia.comentarios.push({ porNombre: session.nombre ?? "", sucursalId: null, texto: `Resuelta: ${texto}` });
    if (incidencia.pedidoId) {
      const pedido = await Pedido.findById(incidencia.pedidoId);
      if (pedido) {
        pedido.historial.push(evento(session, "incidencia", `${TIPO_INCIDENCIA_LABEL[incidencia.tipo as TipoIncidencia]} resuelta: ${texto}`));
        await pedido.save();
      }
    }
  } else {
    if (!texto) return badRequest("Escribe el comentario");
    incidencia.comentarios.push({ porNombre: session.nombre ?? "", sucursalId: session.sucursalId ?? null, texto });
  }

  await incidencia.save();
  return NextResponse.json((await vistasIncidencias([incidencia.toObject()]))[0]);
}
