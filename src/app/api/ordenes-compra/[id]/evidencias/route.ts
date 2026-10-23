import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import OrdenCompra from "@/models/OrdenCompra";
import EvidenciaRecepcion, { EVIDENCIAS_POR_ORDEN, TAMANO_MAXIMO_EVIDENCIA } from "@/models/EvidenciaRecepcion";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede } from "@/lib/apiAuth";

// Fotos de la mercancía rechazada o dañada. Se suben mientras la orden está
// por recibir, para que salgan en el aviso a Compras y al proveedor al confirmar.

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

async function autorizar(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role !== "matriz" || !puede(session, "compras.administrar")) return { error: forbidden() };
  return { session };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await autorizar(req);
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return badRequest("Orden inválida");
  await connectDB();
  const evidencias = await EvidenciaRecepcion.find({ ordenCompraId: id }).sort({ createdAt: 1 }).lean();
  return NextResponse.json(evidencias);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await autorizar(req);
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return badRequest("Orden inválida");
  const body = await req.json().catch(() => null);
  const coincidencia = typeof body?.imagen === "string" ? DATA_URL.exec(body.imagen) : null;
  if (!coincidencia) return badRequest("La foto debe ser JPG, PNG o WebP");
  const datos = Buffer.from(coincidencia[2], "base64");
  if (datos.length > TAMANO_MAXIMO_EVIDENCIA) return badRequest("La foto pesa demasiado; tómala de nuevo o recórtala");
  const nota = typeof body?.nota === "string" ? body.nota.trim().slice(0, 500) : "";

  await connectDB();
  const orden = await OrdenCompra.findById(id).select("estado items").lean();
  if (!orden) return notFound("Orden no encontrada");
  if (orden.estado !== "solicitada") return badRequest("Solo se agregan fotos mientras la orden está por recibir");
  const item = body?.productoId ? orden.items.find((i: { productoId: unknown }) => String(i.productoId) === body.productoId) : null;
  if (body?.productoId && !item) return badRequest("Ese producto no está en la orden");
  if ((await EvidenciaRecepcion.countDocuments({ ordenCompraId: id })) >= EVIDENCIAS_POR_ORDEN) {
    return badRequest(`Una orden admite hasta ${EVIDENCIAS_POR_ORDEN} fotos`);
  }

  const evidencia = await EvidenciaRecepcion.create({
    ordenCompraId: id,
    productoId: item?.productoId ?? null,
    nombreProducto: item?.nombreProducto ?? "",
    nota,
    mime: coincidencia[1],
    datos,
    bytes: datos.length,
    usuarioId: session!.userId,
  });
  const { datos: _omitido, ...metadatos } = evidencia.toObject();
  void _omitido;
  return NextResponse.json(metadatos, { status: 201 });
}
