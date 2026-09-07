import Producto from "@/models/Producto";
import InventarioSucursal from "@/models/InventarioSucursal";
import Sucursal from "@/models/Sucursal";
import { cerrarAlertasResurtidas } from "@/lib/alertasInventario";
import type { SessionPayload } from "@/lib/auth";

export const NOMBRE_MOSTRADOR_MATRIZ = "Matriz (mostrador)";

/**
 * Sucursal que representa el mostrador de la matriz. Se crea sola la primera vez
 * que se usa: así la matriz puede cobrarle al público que llega al CEDIS
 * reutilizando la misma caja, cortes, clientes y devoluciones que las sucursales,
 * sin duplicar toda esa maquinaria.
 */
export async function obtenerMostradorMatriz() {
  return Sucursal.findOneAndUpdate(
    { esMatriz: true },
    { $setOnInsert: { nombre: NOMBRE_MOSTRADOR_MATRIZ, esMatriz: true } },
    { new: true, upsert: true }
  );
}

/**
 * Punto de venta en el que opera la sesión: la sucursal del usuario, o el
 * mostrador si quien vende es matriz. La diferencia entre uno y otro es de
 * dónde sale el inventario, por eso viaja el flag.
 */
export type ContextoPuntoVenta = { sucursalId: string; esMatriz: boolean };

export async function contextoPuntoVenta(session: SessionPayload): Promise<ContextoPuntoVenta | null> {
  if (session.role === "matriz") {
    const mostrador = await obtenerMostradorMatriz();
    return { sucursalId: String(mostrador._id), esMatriz: true };
  }
  if (session.role === "sucursal" && session.sucursalId) {
    return { sucursalId: String(session.sucursalId), esMatriz: false };
  }
  return null;
}

/**
 * Sucursal que está consultando la sesión en las pantallas compartidas
 * (clientes, devoluciones, retiros): la sucursal pide la suya, y matriz la que
 * indique en la query o, si no indica ninguna, su propio mostrador.
 */
export async function sucursalConsultada(session: SessionPayload, url: URL): Promise<string | null> {
  if (session.role !== "matriz") return session.sucursalId ? String(session.sucursalId) : null;
  const solicitada = url.searchParams.get("sucursalId");
  if (solicitada) return solicitada;
  const ctx = await contextoPuntoVenta(session);
  return ctx?.sucursalId ?? null;
}

/** Ubicación con la que se sellan los movimientos de inventario del punto de venta. */
export function ubicacionDeMovimiento(ctx: ContextoPuntoVenta) {
  return ctx.esMatriz ? "matriz" : ctx.sucursalId;
}

/** Existencias disponibles para vender en el punto de venta, por productoId. */
export async function stockPuntoVenta(
  ctx: ContextoPuntoVenta,
  productoIds: string[]
): Promise<Map<string, number>> {
  if (ctx.esMatriz) {
    const productos = await Producto.find({ _id: { $in: productoIds } })
      .select("existenciaMatriz")
      .lean();
    return new Map(productos.map((p) => [String(p._id), p.existenciaMatriz ?? 0]));
  }

  const inventarios = await InventarioSucursal.find({
    sucursalId: ctx.sucursalId,
    productoId: { $in: productoIds },
  })
    .select("productoId stockActual")
    .lean();
  return new Map(inventarios.map((i) => [String(i.productoId), i.stockActual]));
}

/** Suma al inventario del punto de venta (con cantidad negativa, descuenta). */
export async function ajustarStockPuntoVenta(
  ctx: ContextoPuntoVenta,
  productoId: unknown,
  cantidad: number
) {
  if (ctx.esMatriz) {
    await Producto.updateOne({ _id: productoId }, { $inc: { existenciaMatriz: cantidad } });
  } else {
    await InventarioSucursal.findOneAndUpdate(
      { sucursalId: ctx.sucursalId, productoId },
      { $inc: { stockActual: cantidad } },
      { upsert: true }
    );
  }

  // Si vuelve a entrar mercancía (una devolución, una venta cancelada), la
  // alerta de agotado que se le mandó a compras ya no aplica: se cierra sola en
  // vez de quedarse pidiendo lo que ya está en el piso.
  if (cantidad > 0) await cerrarAlertasResurtidas(productoId, ctx.sucursalId);
}
