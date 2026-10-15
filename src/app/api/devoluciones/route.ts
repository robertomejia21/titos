import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Devolucion from "@/models/Devolucion";
import Venta from "@/models/Venta";
import CajaSesion from "@/models/CajaSesion";
import MovimientoInventario from "@/models/MovimientoInventario";
import "@/models/User"; // necesario para que populate("usuarioId"/"pagadaPorId") funcione
import CuentaPorCobrar from "@/models/CuentaPorCobrar";
import TransaccionBanorte from "@/models/TransaccionBanorte";
import { requireSession, unauthorized, forbidden, badRequest, conflict, generateFolio, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import { calcularDevolvible, dentroDeVentana, HORAS_LIMITE_DEVOLUCION } from "@/lib/devoluciones";
import { EPSILON, recalcularSaldoCliente, redondear } from "@/lib/credito";
import {
  ajustarStockPuntoVenta,
  contextoPuntoVenta,
  sucursalConsultada,
  ubicacionDeMovimiento,
} from "@/lib/puntoVenta";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const url = new URL(req.url);

  await connectDB();

  const sucursalId = await sucursalConsultada(session, url);
  if (!sucursalId) return badRequest("Indica la sucursal");

  const filtro: Record<string, unknown> = { sucursalId };
  const estado = url.searchParams.get("estado");
  if (estado) filtro.estado = estado;

  const devoluciones = await Devolucion.find(filtro)
    .sort({ fecha: -1 })
    .limit(200)
    .populate("usuarioId", "nombre")
    .populate("pagadaPorId", "nombre")
    .lean();
  return NextResponse.json(devoluciones);
}

type ItemDevolucion = { productoId: string; cantidad: number };

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "devoluciones.registrar")) return sinPermiso("devoluciones.registrar");
  const body = await req.json().catch(() => null);
  const ventaId = String(body?.ventaId ?? "");
  const itemsBody: ItemDevolucion[] = body?.items ?? [];
  const motivo = String(body?.motivo ?? "").trim();
  // Regresar a la tarjeta en vez de en efectivo (solo ventas cobradas con la
  // terminal Banorte integrada).
  const aTarjeta = body?.aTarjeta === true;

  if (!ventaId) return badRequest("Indica la venta que se está devolviendo");
  if (itemsBody.length === 0) return badRequest("Selecciona al menos un producto a devolver");

  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const venta = await Venta.findById(ventaId);
  if (!venta || String(venta.sucursalId) !== String(ctx.sucursalId)) {
    return badRequest("La venta no existe en esta sucursal");
  }
  if (venta.estado === "cancelada") return badRequest("Esta venta está cancelada, no admite devoluciones");

  const ahora = new Date();
  if (!dentroDeVentana(venta.fecha, ahora)) {
    return conflict(
      `Ya pasaron más de ${HORAS_LIMITE_DEVOLUCION} horas desde la venta ${venta.folio}. No se puede devolver.`
    );
  }

  const devolvible = await calcularDevolvible(venta._id, venta.items);
  const porProducto = new Map(devolvible.map((d) => [d.productoId, d]));

  const items = [];
  let total = 0;

  for (const item of itemsBody) {
    const linea = porProducto.get(String(item.productoId));
    const cantidad = Number(item.cantidad);
    if (!linea) return badRequest("Uno de los productos no pertenece a esta venta");
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    if (cantidad - linea.cantidadDisponible > 0.0005) {
      return badRequest(
        `De ${linea.nombreProducto} solo quedan ${linea.cantidadDisponible} por devolver de esta venta`
      );
    }

    const subtotal = redondear(cantidad * linea.precioUnitario);
    total += subtotal;
    items.push({
      productoId: linea.productoId,
      sku: linea.sku,
      nombreProducto: linea.nombreProducto,
      unidad: linea.unidad,
      cantidad,
      precioUnitario: linea.precioUnitario,
      subtotal,
    });
  }

  if (items.length === 0) return badRequest("Captura las cantidades a devolver");
  total = redondear(total);

  // Si la venta fue a crédito, la devolución abate primero lo que el cliente
  // todavía debe por ella; solo el resto se le reembolsa en efectivo.
  const cuenta = await CuentaPorCobrar.findOne({ ventaId: venta._id, estado: "pendiente" });
  const montoCredito = cuenta ? redondear(Math.min(total, cuenta.saldo)) : 0;

  // Lo que no abate crédito puede regresar a la tarjeta, hasta lo que todavía
  // quede del cobro original (descontando devoluciones a tarjeta ya hechas o en
  // curso). El resto se paga en efectivo.
  let montoTarjeta = 0;
  let tarjeta: Record<string, unknown> | null = null;
  if (aTarjeta) {
    const pagoBanorte = (venta.pagos as { banorte?: { transaccionId?: unknown; referencia?: string; ultimos4?: string } | null }[])
      .find((p) => p.banorte?.transaccionId)?.banorte;
    if (!pagoBanorte) return badRequest("Esta venta no se cobró con la terminal Banorte; la devolución va en efectivo");
    const cobro = await TransaccionBanorte.findById(pagoBanorte.transaccionId).lean<{ monto: number; montoDevuelto?: number; estado: string }>();
    if (!cobro || cobro.estado !== "aprobada") return conflict("El cobro con tarjeta de esta venta ya no está vigente en Banorte");
    const enCurso = await Devolucion.find({ ventaId: venta._id, "tarjeta.estado": "pendiente" }).select("montoTarjeta").lean<{ montoTarjeta?: number }[]>();
    const comprometido = enCurso.reduce((sum, d) => sum + (d.montoTarjeta ?? 0), 0);
    const disponible = redondear((cobro.monto ?? 0) - (cobro.montoDevuelto ?? 0) - comprometido);
    montoTarjeta = redondear(Math.max(0, Math.min(total - montoCredito, disponible)));
    if (montoTarjeta > 0) {
      tarjeta = {
        estado: "pendiente",
        transaccionOriginalId: pagoBanorte.transaccionId,
        referenciaOriginal: pagoBanorte.referencia ?? "",
        ultimos4: pagoBanorte.ultimos4 ?? "",
      };
    }
  }
  const montoEfectivo = redondear(total - montoCredito - montoTarjeta);

  if (cuenta && montoCredito > 0) {
    cuenta.saldo = redondear(cuenta.saldo - montoCredito);
    if (cuenta.saldo <= EPSILON) {
      cuenta.saldo = 0;
      cuenta.estado = "pagada";
    }
    await cuenta.save();
    await recalcularSaldoCliente(cuenta.clienteId);
  }

  // El reembolso en efectivo solo puede salir de una caja abierta. Si el corte
  // del día ya se cerró, la devolución queda pendiente de pago.
  const sesionCaja = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" });
  const sePagaAhora = montoEfectivo <= EPSILON || !!sesionCaja;
  const corteDelDia = todayCorte(await zonaHorariaDeSucursal(ctx.sucursalId));

  const devolucion = await Devolucion.create({
    folio: generateFolio("DEV"),
    sucursalId: ctx.sucursalId,
    ventaId: venta._id,
    ventaFolio: venta.folio,
    ventaFecha: venta.fecha,
    clienteId: venta.clienteId ?? null,
    clienteNombre: venta.clienteNombre ?? "",
    items,
    total,
    montoCredito,
    montoEfectivo,
    montoTarjeta,
    tarjeta,
    estado: sePagaAhora ? "pagada" : "pendiente",
    motivo,
    usuarioId: session.userId,
    fecha: ahora,
    corte: corteDelDia,
    cajaSesionId: sePagaAhora && sesionCaja ? sesionCaja._id : null,
    cortePago: sePagaAhora ? corteDelDia : null,
    pagadaEn: sePagaAhora ? ahora : null,
    pagadaPorId: sePagaAhora ? session.userId : null,
  });

  // El producto regresa al inventario del punto de venta al capturar la
  // devolución, independientemente de cuándo se le pague al cliente.
  for (const item of items) {
    await ajustarStockPuntoVenta(ctx, item.productoId, item.cantidad);
    await MovimientoInventario.create({
      tipo: "entrada_devolucion",
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      ubicacion: ubicacionDeMovimiento(ctx),
      cantidad: item.cantidad,
      ventaId: venta._id,
      devolucionId: devolucion._id,
      usuarioId: session.userId,
    });
  }

  return NextResponse.json(devolucion, { status: 201 });
}
