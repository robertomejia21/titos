import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, badRequest, conflict, notFound } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import { validarPromocion } from "@/lib/promociones";
import { validarSeleccionPromocion } from "@/lib/promocionesServidor";
import Promocion from "@/models/Promocion";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(req);
  if (!s) return unauthorized();
  if (s.role !== "matriz" || !puede(s, "precios.actualizar")) return forbidden();
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) return badRequest("Promoción inválida.");
  const body = await req.json().catch(() => null);
  let datos;
  try { datos = validarPromocion(body); } catch (e) { return badRequest(e instanceof Error ? e.message : "Datos inválidos."); }
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) return badRequest("Recarga la promoción antes de editarla.");
  await connectDB();
  // Archivar permite retirar un borrador aunque sus productos ya estén inactivos.
  if (datos.estado !== "archivado") {
    try { await validarSeleccionPromocion(datos); } catch (e) { return badRequest(e instanceof Error ? e.message : "Selección inválida."); }
  }
  const promocion = await Promocion.findOneAndUpdate({ _id: id, revision: body.revision }, {
    $set: { ...datos, actualizadoPorId: s.userId, actualizadoPor: s.nombre }, $inc: { revision: 1 },
  }, { returnDocument: "after", runValidators: true }).lean();
  if (!promocion) return await Promocion.exists({ _id: id }) ? conflict("Otra persona modificó este borrador. Recarga la página para ver sus cambios antes de guardar.") : notFound();
  return NextResponse.json(promocion);
}
