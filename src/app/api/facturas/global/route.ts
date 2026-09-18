import { NextRequest, NextResponse } from "next/server";
import mongoose, { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  requireSession,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
  generateFolio,
  puede,
} from "@/lib/apiAuth";
import { ErrorFacturaGlobal, resumenFacturaGlobal } from "@/lib/facturaGlobal";
import FacturaGlobal from "@/models/FacturaGlobal";
import Venta from "@/models/Venta";

export async function GET(req: NextRequest) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "matriz" || !puede(usuario, "facturas.administrar"))
    return forbidden();
  const sucursalId = req.nextUrl.searchParams.get("sucursalId") || "";
  if (sucursalId && !isValidObjectId(sucursalId))
    return badRequest("Sucursal inválida.");
  await connectDB();
  try {
    return NextResponse.json(
      await resumenFacturaGlobal(
        sucursalId,
        req.nextUrl.searchParams.get("dia") || undefined,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ErrorFacturaGlobal) return badRequest(error.message);
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "matriz" || !puede(usuario, "facturas.administrar"))
    return forbidden();
  const body = await req.json().catch(() => null);
  const sucursalId =
    typeof body?.sucursalId === "string" ? body.sucursalId : "";
  if (sucursalId && !isValidObjectId(sucursalId))
    return badRequest("Sucursal inválida.");
  if (typeof body?.dia !== "string" || typeof body?.huella !== "string")
    return badRequest(
      "Consulta primero el día para generar su factura global.",
    );
  await connectDB();
  await FacturaGlobal.init();
  try {
    const factura = await mongoose.connection.transaction(async (tx) => {
      const resumen = await resumenFacturaGlobal(sucursalId, body.dia, tx);
      if (resumen.dia >= resumen.hoy)
        throw new ErrorFacturaGlobal(
          "Espera a que termine el día antes de generar la global.",
        );
      if (resumen.huella !== body.huella)
        throw new ErrorFacturaGlobal(
          "Las ventas o sus facturas cambiaron. Actualiza y revisa los importes antes de generar.",
        );
      if (resumen.avisos.length)
        throw new ErrorFacturaGlobal(resumen.avisos[0]);
      if (!resumen.pendientes.length)
        throw new ErrorFacturaGlobal(
          "No hay ventas pendientes para incluir en la global.",
        );
      const alcance = sucursalId || "todas";
      if (
        await FacturaGlobal.exists({
          alcance,
          dia: resumen.dia,
          estado: "generada",
        }).session(tx)
      )
        throw new ErrorFacturaGlobal(
          "Ya existe una global vigente para este día y alcance. Cancélala antes de regenerarla.",
        );
      const id = new mongoose.Types.ObjectId();
      const ids = resumen.pendientes.map((v) => v.ventaId);
      const lock = await Venta.updateMany(
        {
          _id: { $in: ids },
          estado: "completada",
          corte: resumen.dia,
          facturaGlobalId: null,
        },
        { $set: { facturaGlobalId: id }, $inc: { versionFacturacion: 1 } },
        { session: tx },
      );
      if (lock.modifiedCount !== ids.length)
        throw new ErrorFacturaGlobal(
          "Una venta cambió mientras se generaba la global. Actualiza el resumen.",
        );
      const [doc] = await FacturaGlobal.create(
        [
          {
            _id: id,
            folio: generateFolio("GLO"),
            alcance,
            dia: resumen.dia,
            sucursalId: sucursalId || null,
            sucursalNombre: resumen.sucursalNombre,
            zonaHoraria: resumen.zonaHoraria,
            mes: resumen.dia.slice(5, 7),
            anio: Number(resumen.dia.slice(0, 4)),
            ventas: resumen.pendientes,
            total: resumen.totalPendiente,
            conciliacion: {
              totalVentas: resumen.totalVentas,
              individuales: resumen.totalIndividuales,
              globalesAnteriores: resumen.totalGlobales,
            },
            creadoPorId: usuario.userId,
            creadoPorNombre: usuario.nombre,
          },
        ],
        { session: tx },
      );
      return doc;
    });
    return NextResponse.json(factura, { status: 201 });
  } catch (error) {
    if (error instanceof ErrorFacturaGlobal) return conflict(error.message);
    if ((error as { code?: number }).code === 11000)
      return conflict(
        "Ya se generó la global. Actualiza la consulta para verla.",
      );
    throw error;
  }
}
