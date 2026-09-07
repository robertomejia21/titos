import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import AlertaInventarioCero from "@/models/AlertaInventarioCero";
import { requireSession, unauthorized, forbidden, notFound, puede, sinPermiso } from "@/lib/apiAuth";

/**
 * Marca un faltante como atendido (ya se ordenó, o ya se resurtió a mano). No se
 * borra: queda el registro de cuánto tardó en atenderse cada agotado.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "compras.administrar")) return sinPermiso("compras.administrar");

  const { id } = await params;

  await connectDB();
  const alerta = await AlertaInventarioCero.findById(id);
  if (!alerta) return notFound("Alerta no encontrada");

  alerta.estado = "atendida";
  alerta.atendidaEn = new Date();
  alerta.atendidaPorId = session.userId;
  alerta.atendidaPorNombre = session.nombre ?? "";
  await alerta.save();

  return NextResponse.json({ ok: true });
}
