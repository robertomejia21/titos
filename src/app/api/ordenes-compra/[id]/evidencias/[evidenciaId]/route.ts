import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import OrdenCompra from "@/models/OrdenCompra";
import EvidenciaRecepcion, { bytesEvidencia } from "@/models/EvidenciaRecepcion";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede } from "@/lib/apiAuth";

type Params = { params: Promise<{ id: string; evidenciaId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "compras.administrar")) return forbidden();
  const { id, evidenciaId } = await params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(evidenciaId)) return badRequest("Evidencia inválida");
  await connectDB();
  const evidencia = await EvidenciaRecepcion.findOne({ _id: evidenciaId, ordenCompraId: id }).select("+datos mime").lean();
  if (!evidencia) return notFound("Foto no encontrada");
  return new NextResponse(new Uint8Array(bytesEvidencia(evidencia.datos)), {
    headers: { "Content-Type": evidencia.mime, "Cache-Control": "private, max-age=86400" },
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "compras.administrar")) return forbidden();
  const { id, evidenciaId } = await params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(evidenciaId)) return badRequest("Evidencia inválida");
  await connectDB();
  const orden = await OrdenCompra.findById(id).select("estado").lean();
  if (!orden) return notFound("Orden no encontrada");
  // Ya recibida, la foto es parte de la constancia del rechazo: no se borra.
  if (orden.estado !== "solicitada") return badRequest("La orden ya se recibió; sus fotos quedan como evidencia");
  await EvidenciaRecepcion.deleteOne({ _id: evidenciaId, ordenCompraId: id });
  return NextResponse.json({ ok: true });
}
