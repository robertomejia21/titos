import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Venta from "@/models/Venta";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { calcularDevolvible, dentroDeVentana, horasRestantes, HORAS_LIMITE_DEVOLUCION } from "@/lib/devoluciones";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { candidatosFolioVenta } from "@/lib/folios";

/** Busca una venta por folio y devuelve qué se le puede devolver todavía. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const folio = (new URL(req.url).searchParams.get("folio") ?? "").trim();
  if (!folio) return badRequest("Captura el folio de la venta");

  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  // Se aceptan las tres formas de dictar un folio: completo ("VTA-000123"), el
  // número pelón ("123") o con ceros. Se buscan folios exactos y no por
  // "contiene", que haría que el 123 trajera también el 1234 y el 5123.
  const candidatos = candidatosFolioVenta(folio);
  const venta = await Venta.findOne({
    folio: { $in: candidatos },
    sucursalId: ctx.sucursalId,
  });
  if (!venta) {
    return notFound(
      `No se encontró la venta ${folio} en esta sucursal. Puedes capturar solo el número (ej. 123) o el folio completo.`
    );
  }

  const ahora = new Date();
  const items = await calcularDevolvible(venta._id, venta.items);
  const enVentana = dentroDeVentana(venta.fecha, ahora);

  return NextResponse.json({
    venta: {
      _id: String(venta._id),
      folio: venta.folio,
      fecha: venta.fecha,
      total: venta.total,
      estado: venta.estado,
      clienteNombre: venta.clienteNombre ?? "",
      pagos: venta.pagos,
    },
    items,
    enVentana,
    cancelada: venta.estado === "cancelada",
    horasRestantes: Number(horasRestantes(venta.fecha, ahora).toFixed(1)),
    horasLimite: HORAS_LIMITE_DEVOLUCION,
  });
}
