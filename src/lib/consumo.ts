import mongoose from "mongoose";
import Venta from "@/models/Venta";
import InventarioSucursal from "@/models/InventarioSucursal";
import { sumarDias } from "@/lib/zonasHorarias";

// Patrón de consumo por tienda para el Nivelador (minuta del 28 de octubre):
// cuánto vende al día cada sucursal de cada producto en la ventana elegida
// (mensual = 30 días, bimestral = 60) y cuánto tiene hoy. Con eso se sugiere
// cuánto mandarle para cubrir unos días.

export type ConsumoTienda = { stock: number; consumoDiario: number; sugerido: number };

/** Lo que conviene mandar para cubrir `diasCobertura` días, descontando lo que ya hay. */
export function cantidadSugerida(consumoDiario: number, stock: number, diasCobertura: number) {
  return Math.max(0, Math.ceil(consumoDiario * diasCobertura - Math.max(0, stock)));
}

/** sucursalId → productoId → consumo, con ventas completadas antes de `hasta` (YYYY-MM-DD). */
export async function consumoPorTienda(productoIds: string[], hasta: string, { ventanaDias, diasCobertura }: { ventanaDias: number; diasCobertura: number }) {
  const ids = productoIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  const resultado = new Map<string, Map<string, ConsumoTienda>>();
  if (!ids.length) return resultado;
  const desde = sumarDias(hasta, -ventanaDias);

  const [ventas, inventario] = await Promise.all([
    Venta.aggregate<{ _id: { sucursalId: unknown; productoId: unknown }; total: number }>([
      { $match: { estado: "completada", corte: { $gte: desde, $lt: hasta }, "items.productoId": { $in: ids } } },
      { $unwind: "$items" },
      { $match: { "items.productoId": { $in: ids } } },
      { $group: { _id: { sucursalId: "$sucursalId", productoId: "$items.productoId" }, total: { $sum: "$items.cantidad" } } },
    ]),
    InventarioSucursal.find({ productoId: { $in: ids } }).select("sucursalId productoId stockActual").lean(),
  ]);

  const celda = (s: string, p: string) => {
    if (!resultado.has(s)) resultado.set(s, new Map());
    const fila = resultado.get(s)!;
    if (!fila.has(p)) fila.set(p, { stock: 0, consumoDiario: 0, sugerido: 0 });
    return fila.get(p)!;
  };
  for (const v of ventas) celda(String(v._id.sucursalId), String(v._id.productoId)).consumoDiario = Math.round((v.total / ventanaDias) * 100) / 100;
  for (const i of inventario) celda(String(i.sucursalId), String(i.productoId)).stock = i.stockActual ?? 0;
  for (const fila of resultado.values()) for (const c of fila.values()) c.sugerido = cantidadSugerida(c.consumoDiario, c.stock, diasCobertura);
  return resultado;
}
