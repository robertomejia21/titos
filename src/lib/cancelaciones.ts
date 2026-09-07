import CancelacionPos, { type TIPOS_CANCELACION } from "@/models/CancelacionPos";
import CajaSesion from "@/models/CajaSesion";
import Sucursal from "@/models/Sucursal";
import { generateFolio, todayCorte } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import type { ContextoPuntoVenta } from "@/lib/puntoVenta";
import type { SessionPayload } from "@/lib/auth";

export type TipoCancelacion = (typeof TIPOS_CANCELACION)[number];

export type ItemCancelado = {
  productoId?: unknown;
  sku?: string;
  nombreProducto?: string;
  unidad?: string;
  cantidad?: number;
  precioUnitario?: number;
  importe?: number;
};

/** Normaliza lo que manda el punto de venta: nunca se confía en el importe del cliente. */
export function normalizarItemsCancelados(items: unknown): ItemCancelado[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 200).map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const cantidad = Number(item.cantidad) || 0;
    const precioUnitario = Number(item.precioUnitario) || 0;
    return {
      productoId: typeof item.productoId === "string" && item.productoId.length === 24 ? item.productoId : null,
      sku: String(item.sku ?? "").slice(0, 60),
      nombreProducto: String(item.nombreProducto ?? "").slice(0, 200),
      unidad: String(item.unidad ?? "").slice(0, 10),
      cantidad,
      precioUnitario,
      importe: Math.round(cantidad * precioUnitario * 100) / 100,
    };
  });
}

export async function registrarCancelacion({
  tipo,
  ctx,
  session,
  motivo,
  autorizadoConNip,
  autorizadoPor = null,
  items = [],
  ventaId = null,
  ventaFolio = "",
  importe,
}: {
  tipo: TipoCancelacion;
  ctx: ContextoPuntoVenta;
  session: SessionPayload;
  motivo: string;
  autorizadoConNip: boolean;
  /** Encargado de turno que autorizó con su NIP personal, si lo hubo. */
  autorizadoPor?: { id: string; nombre: string } | null;
  items?: ItemCancelado[];
  ventaId?: unknown;
  ventaFolio?: string;
  importe?: number;
}) {
  const [sucursal, sesionCaja, zonaHoraria] = await Promise.all([
    Sucursal.findById(ctx.sucursalId).select("nombre").lean(),
    CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" }).select("_id").lean(),
    zonaHorariaDeSucursal(ctx.sucursalId),
  ]);

  const total =
    importe != null
      ? Math.round(importe * 100) / 100
      : Math.round(items.reduce((sum, i) => sum + (i.importe ?? 0), 0) * 100) / 100;

  return CancelacionPos.create({
    folio: generateFolio("CAN"),
    tipo,
    sucursalId: ctx.sucursalId,
    sucursalNombre: (sucursal as { nombre?: string } | null)?.nombre ?? "",
    esMatriz: ctx.esMatriz,
    usuarioId: session.userId,
    usuarioNombre: session.nombre,
    cajaSesionId: (sesionCaja as { _id?: unknown } | null)?._id ?? null,
    ventaId,
    ventaFolio,
    items,
    importe: total,
    motivo,
    autorizadoConNip,
    autorizadoPorId: autorizadoPor?.id ?? null,
    autorizadoPorNombre: autorizadoPor?.nombre ?? "",
    fecha: new Date(),
    corte: todayCorte(zonaHoraria),
  });
}
