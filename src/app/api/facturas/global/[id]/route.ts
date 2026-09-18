import { NextRequest, NextResponse } from "next/server";
import mongoose, { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  requireSession,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
  puede,
} from "@/lib/apiAuth";
import { ErrorFacturaGlobal } from "@/lib/facturaGlobal";
import FacturaGlobal from "@/models/FacturaGlobal";
import Venta from "@/models/Venta";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "matriz" || !puede(usuario, "facturas.administrar"))
    return forbidden();
  const { id } = await params;
  if (!isValidObjectId(id)) return badRequest("Factura inválida.");
  const body = await req.json().catch(() => null);
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  if (motivo.length < 5 || motivo.length > 1000)
    return badRequest("Escribe un motivo de 5 a 1,000 caracteres.");
  await connectDB();
  try {
    await mongoose.connection.transaction(async (tx) => {
      const global = await FacturaGlobal.findOneAndUpdate(
        { _id: id, estado: "generada" },
        {
          $set: {
            estado: "cancelada",
            motivoCancelacion: motivo,
            canceladaEn: new Date(),
            canceladaPorId: usuario.userId,
          },
        },
        { session: tx },
      );
      if (!global)
        throw new ErrorFacturaGlobal(
          "La global no existe o ya está cancelada.",
        );
      await Venta.updateMany(
        { facturaGlobalId: id },
        { $set: { facturaGlobalId: null }, $inc: { versionFacturacion: 1 } },
        { session: tx },
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ErrorFacturaGlobal) return conflict(error.message);
    throw error;
  }
}
