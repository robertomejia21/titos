import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Venta from "@/models/Venta";
import MovimientoInventario from "@/models/MovimientoInventario";
import CuentaPorCobrar from "@/models/CuentaPorCobrar";
import Factura from "@/models/Factura";
import { requireSession, unauthorized, forbidden, badRequest, notFound, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { EPSILON, recalcularSaldoCliente } from "@/lib/credito";
import { ajustarStockPuntoVenta, contextoPuntoVenta, ubicacionDeMovimiento } from "@/lib/puntoVenta";
import { verificarNipSupervisor } from "@/lib/configuracion";
import { registrarCancelacion } from "@/lib/cancelaciones";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pos.cancelar")) return sinPermiso("pos.cancelar");

  // Cancelar una venta cobrada devuelve stock y dinero, por eso la autoriza un
  // supervisor con su NIP y queda en la bitácora de cancelaciones.
  const body = await req.json().catch(() => null);
  const motivo = String(body?.motivo ?? "").trim();
  const nip = String(body?.nip ?? "").trim();
  if (!motivo) return badRequest("Captura el motivo de la cancelación");

  const { id } = await params;
  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const autorizacion = await verificarNipSupervisor(nip, ctx.sucursalId);
  if (!autorizacion.ok) return badRequest(autorizacion.error);

  const venta = await Venta.findById(id);
  if (!venta) return notFound("Venta no encontrada");
  if (String(venta.sucursalId) !== ctx.sucursalId) return forbidden();
  if (venta.estado === "cancelada") return badRequest("Esta venta ya está cancelada");

  // Si ya se facturó, primero hay que cancelar la factura: si no, quedaría un
  // documento fiscal amparando una venta que ya no existe.
  const factura = await Factura.findOne({ ventaId: venta._id, estado: "generada" }).select("folio").lean();
  if (factura) {
    return conflict(
      `No se puede cancelar: esta venta ya se facturó con el folio ${
        (factura as { folio: string }).folio
      }. Cancela primero la factura.`
    );
  }

  // Si la venta fue a crédito, su cuenta por cobrar se cancela junto con ella.
  // No se puede si el cliente ya abonó algo: eso requiere una nota de crédito.
  const cuenta = await CuentaPorCobrar.findOne({ ventaId: venta._id, estado: { $ne: "cancelada" } });
  if (cuenta) {
    if (cuenta.monto - cuenta.saldo > EPSILON) {
      return conflict(
        "No se puede cancelar: el cliente ya abonó a esta venta a crédito. Ajusta su estado de cuenta con un abono en su lugar."
      );
    }
    cuenta.estado = "cancelada";
    cuenta.saldo = 0;
    await cuenta.save();
    await recalcularSaldoCliente(cuenta.clienteId);
  }

  type VentaItemDoc = (typeof venta.items)[number];

  for (const item of venta.items as VentaItemDoc[]) {
    await ajustarStockPuntoVenta(ctx, item.productoId, item.cantidad);
    await MovimientoInventario.create({
      tipo: "entrada_sucursal",
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      ubicacion: ubicacionDeMovimiento(ctx),
      cantidad: item.cantidad,
      ventaId: venta._id,
      usuarioId: session.userId,
    });
  }

  venta.estado = "cancelada";
  await venta.save();

  await registrarCancelacion({
    tipo: "venta",
    ctx,
    session,
    motivo,
    autorizadoConNip: autorizacion.autorizadoConNip,
    ventaId: venta._id,
    ventaFolio: venta.folio,
    importe: venta.total,
    items: (venta.items as VentaItemDoc[]).map((item) => ({
      productoId: item.productoId,
      sku: item.sku,
      nombreProducto: item.nombreProducto,
      unidad: item.unidad,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      importe: item.subtotal,
    })),
  });

  return NextResponse.json(venta);
}
