import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Venta from "@/models/Venta";
import Factura from "@/models/Factura";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";

/**
 * Ventas completadas que todavía no tienen factura. Es la bandeja desde la que
 * matriz convierte una nota de venta del punto de venta en factura.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  await connectDB();

  const url = new URL(req.url);
  const filtro: Record<string, unknown> = { estado: "completada", facturaGlobalId: null };

  const sucursalId = url.searchParams.get("sucursalId");
  if (sucursalId) filtro.sucursalId = sucursalId;

  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (desde || hasta) {
    const rango: Record<string, string> = {};
    if (desde) rango.$gte = desde;
    if (hasta) rango.$lte = hasta;
    filtro.corte = rango;
  }

  const busqueda = url.searchParams.get("q")?.trim();
  if (busqueda) {
    const regex = new RegExp(busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filtro.$or = [{ folio: regex }, { clienteNombre: regex }];
  }

  const ventas = await Venta.find(filtro)
    .select("folio fecha corte sucursalId clienteId clienteNombre total pagos items esVentas2")
    .sort({ fecha: -1 })
    .limit(600)
    .lean();

  // Se descartan las que ya tienen una factura vigente. Una venta cuya factura
  // se canceló vuelve a aparecer aquí para poder emitirla de nuevo.
  const facturadas = new Set(
    (
      await Factura.find({ ventaId: { $in: ventas.map((v) => v._id) }, estado: "generada" })
        .select("ventaId")
        .lean()
    ).map((f) => String(f.ventaId))
  );

  const sucursales = await Sucursal.find({}).select("nombre").lean();
  const nombrePorSucursal = new Map(sucursales.map((s) => [String(s._id), s.nombre as string]));

  return NextResponse.json(
    ventas
      .filter((v) => !facturadas.has(String(v._id)))
      .map((v) => ({
        _id: String(v._id),
        folio: v.folio,
        fecha: v.fecha ? new Date(v.fecha).toISOString() : "",
        corte: v.corte,
        sucursalId: String(v.sucursalId),
        sucursalNombre: nombrePorSucursal.get(String(v.sucursalId)) ?? "Sucursal",
        clienteId: v.clienteId ? String(v.clienteId) : null,
        clienteNombre: v.clienteNombre ?? "",
        total: v.total,
        esVentas2: !!v.esVentas2,
        articulos: (v.items ?? []).length,
        pagos: ((v.pagos ?? []) as { metodoPago: string; monto: number }[]).map((p) => ({
          metodoPago: p.metodoPago,
          monto: p.monto,
        })),
      }))
  );
}
