import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import AlertaInventarioCero from "@/models/AlertaInventarioCero";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";

// Faltantes que reporta el piso de venta. Es la red de seguridad del WhatsApp:
// si el aviso no salió (Evolution API caída, sin números capturados), el área de
// compras los sigue viendo aquí.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "compras.administrar")) return sinPermiso("compras.administrar");

  await connectDB();

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") ?? "abierta";
  const filtro: Record<string, unknown> = {};
  if (estado !== "todas") filtro.estado = estado;

  const alertas = await AlertaInventarioCero.find(filtro).sort({ fecha: -1 }).limit(300).lean();

  return NextResponse.json(
    alertas.map((a) => ({
      _id: String(a._id),
      productoId: String(a.productoId),
      sku: a.sku ?? "",
      nombreProducto: a.nombreProducto ?? "",
      unidad: a.unidad ?? "",
      sucursalNombre: a.sucursalNombre ?? "",
      ventaFolio: a.ventaFolio ?? "",
      cantidadVendida: a.cantidadVendida ?? 0,
      stockResultante: a.stockResultante ?? 0,
      vendidoSinExistencia: !!a.vendidoSinExistencia,
      fecha: a.fecha ? new Date(a.fecha).toISOString() : null,
      estado: a.estado,
      notificada: !!a.notificada,
      errorNotificacion: a.errorNotificacion ?? "",
    }))
  );
}
