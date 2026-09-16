import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import TerminalPago from "@/models/TerminalPago";
import Venta from "@/models/Venta";
import { requireSession, unauthorized, forbidden, notFound, conflict, badRequest, puede, sinPermiso } from "@/lib/apiAuth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "catalogos.administrar")) return sinPermiso("catalogos.administrar");
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();

  const update: Record<string, unknown> = {};
  for (const key of ["alias", "banco", "marca", "numeroSerie"]) {
    if (key in body) update[key] = String(body[key] ?? "").trim();
  }
  if ("activo" in body) update.activo = !!body.activo;
  if ("alias" in body && !update.alias) return badRequest("El nombre de la terminal no puede quedar vacío");

  try {
    const terminal = await TerminalPago.findByIdAndUpdate(id, update, { returnDocument: "after" });
    if (!terminal) return notFound("Terminal no encontrada");
    return NextResponse.json(terminal);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return conflict("Esa sucursal ya tiene una terminal con ese nombre");
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "catalogos.administrar")) return sinPermiso("catalogos.administrar");
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;

  await connectDB();

  const terminal = await TerminalPago.findById(id);
  if (!terminal) return notFound("Terminal no encontrada");

  // Si ya cobró algo, borrarla dejaría cortes viejos sin poder explicar de dónde
  // salió ese depósito. Se desactiva y deja de aparecer en el punto de venta.
  const yaCobro = await Venta.exists({ "pagos.terminalId": terminal._id });
  if (yaCobro) {
    return conflict("Esta terminal ya tiene cobros registrados; desactívala en lugar de eliminarla");
  }

  await TerminalPago.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
