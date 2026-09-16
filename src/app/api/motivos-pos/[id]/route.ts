import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import MotivoPos from "@/models/MotivoPos";
import { requireSession, unauthorized, forbidden, badRequest, notFound, conflict } from "@/lib/apiAuth";
import { normalizarMotivo } from "@/lib/motivosPos";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  const update: Record<string, unknown> = {};
  if ("texto" in body) {
    const texto = normalizarMotivo(body.texto);
    if (!texto) return badRequest("Captura el texto del motivo");
    update.texto = texto;
  }
  if ("activo" in body) update.activo = !!body.activo;
  if ("orden" in body) {
    const orden = Number(body.orden);
    if (!Number.isFinite(orden)) return badRequest("Orden inválido");
    update.orden = orden;
  }

  const { id } = await params;
  await connectDB();

  try {
    const motivo = await MotivoPos.findByIdAndUpdate(id, update, { returnDocument: "after", runValidators: true }).lean();
    if (!motivo) return notFound("Motivo no encontrado");
    return NextResponse.json({ ...motivo, _id: String((motivo as { _id: unknown })._id) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return conflict("Ese motivo ya existe para este tipo");
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  await connectDB();

  const motivo = await MotivoPos.findByIdAndDelete(id).lean();
  if (!motivo) return notFound("Motivo no encontrado");

  return NextResponse.json({ ok: true });
}
