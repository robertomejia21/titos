import { NextRequest, NextResponse } from "next/server";
import mongoose, { isValidObjectId } from "mongoose";
import Producto from "@/models/Producto";
import type { FiscalProducto } from "@/lib/fiscalProducto";
import { ErrorFacturaGlobal } from "@/lib/facturaGlobal";
import { connectDB } from "@/lib/db";
import Factura from "@/models/Factura";
import Venta from "@/models/Venta";
import Cliente from "@/models/Cliente";
import Sucursal from "@/models/Sucursal";
import {
  requireSession,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  conflict,
  generateFolio,
  todayCorte,
} from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import {
  desglosarFactura,
  formaPagoSat,
  metodoPagoSat,
  type ItemVentaLike,
} from "@/lib/facturas";
import { parseReceptor } from "@/lib/facturaReceptor";
import { obtenerConfiguracion } from "@/lib/configuracion";

/** Facturas emitidas, con filtros por sucursal, fecha, estado y búsqueda libre. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  await connectDB();

  const url = new URL(req.url);
  const filtro: Record<string, unknown> = {};

  const sucursalId = url.searchParams.get("sucursalId");
  if (sucursalId) filtro.sucursalId = sucursalId;

  const estado = url.searchParams.get("estado");
  if (estado === "generada" || estado === "cancelada") filtro.estado = estado;

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
    const regex = new RegExp(
      busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filtro.$or = [
      { folio: regex },
      { ventaFolio: regex },
      { "receptor.rfc": regex },
      { "receptor.razonSocial": regex },
    ];
  }

  const facturas = await Factura.find(filtro)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return NextResponse.json(facturas.map((f) => JSON.parse(JSON.stringify(f))));
}

/** Convierte una venta del punto de venta en factura del sistema. */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  const ventaId = String(body?.ventaId ?? "");
  if (!isValidObjectId(ventaId))
    return badRequest("Indica una venta válida para facturar.");

  await connectDB();

  const venta = await Venta.findById(ventaId).lean();
  if (!venta) return notFound("Venta no encontrada");
  if (venta.estado !== "completada")
    return badRequest("Solo se pueden facturar ventas completadas");

  const yaFacturada = await Factura.findOne({
    ventaId: venta._id,
    estado: "generada",
  })
    .select("folio")
    .lean();
  if (yaFacturada) {
    return conflict(
      `Esta venta ya se facturó con el folio ${(yaFacturada as { folio: string }).folio}`,
    );
  }

  // Los datos fiscales pueden venir de un cliente ya dado de alta o capturarse a
  // mano para quien llega con su constancia y no está en el padrón.
  const clienteId = body?.clienteId ? String(body.clienteId) : null;
  let receptorBase = body?.receptor ?? null;
  let cliente = null;

  if (clienteId) {
    cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) return badRequest("El cliente indicado no existe");
    if (!receptorBase) {
      receptorBase = {
        ...(cliente.facturacion ?? {}),
        razonSocial: cliente.facturacion?.razonSocial || cliente.nombre,
      };
    }
  }

  const receptor = parseReceptor(receptorBase);
  if ("error" in receptor) return badRequest(receptor.error);

  const config = await obtenerConfiguracion();
  const tasaIva = Number(body?.tasaIva ?? config.tasaIvaFactura ?? 0);
  if (!Number.isFinite(tasaIva) || tasaIva < 0 || tasaIva > 100)
    return badRequest("Tasa de IVA inválida");

  const pagos = (venta.pagos ?? []) as { metodoPago: string; monto: number }[];

  // Las tasas de los productos que aparecen en la venta. Hacen falta para las
  // ventas que se cobraron antes de que el mostrador calculara impuestos: sin
  // ellas el desglose sale con la tasa global y el CFDI no cuadra.
  const ventaItems = (venta.items ?? []) as unknown as ItemVentaLike[];
  const productosVenta = await Producto.find({
    _id: { $in: ventaItems.map((i) => i.productoId).filter(Boolean) },
  })
    .select("_id fiscal")
    .lean<{ _id: mongoose.Types.ObjectId; fiscal?: FiscalProducto }[]>();
  const fiscalPorProducto = new Map(
    productosVenta.filter((p) => p.fiscal).map((p) => [String(p._id), p.fiscal as FiscalProducto]),
  );

  const { conceptos, subtotal, iva, total } = desglosarFactura(
    ventaItems,
    venta.total,
    tasaIva,
    fiscalPorProducto,
  );

  const sucursal = await Sucursal.findById(venta.sucursalId)
    .select("nombre")
    .lean();
  const comentarioInicial = String(body?.comentario ?? "").trim();

  try {
    const factura = await mongoose.connection.transaction(async (tx) => {
      const bloqueada = await Venta.updateOne(
        {
          _id: venta._id,
          estado: "completada",
          corte: venta.corte,
          facturaGlobalId: null,
        },
        { $inc: { versionFacturacion: 1 } },
        { session: tx },
      );
      if (!bloqueada.modifiedCount)
        throw new ErrorFacturaGlobal(
          "La venta está incluida en una global o cambió. Cancela la global interna antes de facturarla individualmente.",
        );
      if (
        await Factura.exists({
          ventaId: venta._id,
          estado: "generada",
        }).session(tx)
      )
        throw new ErrorFacturaGlobal(
          "Esta venta ya tiene una factura vigente.",
        );
      const [creada] = await Factura.create(
        [
          {
            folio: generateFolio("FAC"),
            serie:
              String(body?.serie ?? "A")
                .trim()
                .toUpperCase()
                .slice(0, 5) || "A",
            ventaId: venta._id,
            ventaFolio: venta.folio,
            ventaFecha: venta.fecha,
            sucursalId: venta.sucursalId,
            sucursalNombre:
              (sucursal as { nombre?: string } | null)?.nombre ?? "",
            clienteId: cliente?._id ?? venta.clienteId ?? null,
            receptor: receptor.data,
            conceptos,
            tasaIva,
            subtotal,
            iva,
            total,
            formaPago: String(body?.formaPago ?? "") || formaPagoSat(pagos),
            metodoPago: String(body?.metodoPago ?? "") || metodoPagoSat(pagos),
            comentarios: comentarioInicial
              ? [
                  {
                    texto: comentarioInicial,
                    usuarioId: session.userId,
                    usuarioNombre: session.nombre,
                    fecha: new Date(),
                  },
                ]
              : [],
            creadoPorId: session.userId,
            creadoPorNombre: session.nombre,
            corte: todayCorte(await zonaHorariaDeSucursal(venta.sucursalId)),
          },
        ],
        { session: tx },
      );
      return creada;
    });
    return NextResponse.json(JSON.parse(JSON.stringify(factura)), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof ErrorFacturaGlobal) return conflict(error.message);
    throw error;
  }
}
