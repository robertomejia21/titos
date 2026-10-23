export class ErrorRecepcion extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
import { MOTIVOS_RECHAZO, type MotivoRechazo } from "@/lib/motivosRechazo";
export type EntradaRecepcion = {productoId: string; cantidadRecibida: number; pesoRecibidoKg?: number; notaRecepcion: string; cantidadRechazada: number; motivoRechazo: MotivoRechazo | ""};
export function validarRecepcion(valor: unknown): EntradaRecepcion[] {
  if (!Array.isArray(valor) || !valor.length) throw new ErrorRecepcion("Captura todos los productos de la recepción");
  const ids = new Set<string>();
  return valor.map((item) => {
    if (!item || typeof item.productoId !== "string" || ids.has(item.productoId)) throw new ErrorRecepcion("Hay productos inválidos o repetidos");
    ids.add(item.productoId);
    if (typeof item.cantidadRecibida !== "number" || !Number.isFinite(item.cantidadRecibida) || item.cantidadRecibida < 0) throw new ErrorRecepcion("La cantidad recibida debe ser un número mayor o igual a cero");
    if (item.pesoRecibidoKg != null && (typeof item.pesoRecibidoKg !== "number" || !Number.isFinite(item.pesoRecibidoKg) || item.pesoRecibidoKg < 0)) throw new ErrorRecepcion("El peso recibido no es válido");
    if (item.notaRecepcion != null && (typeof item.notaRecepcion !== "string" || item.notaRecepcion.length > 1000)) throw new ErrorRecepcion("La nota admite hasta 1,000 caracteres");
    // Devolución en el andén: lo que trajo el proveedor y se le regresó. Siempre
    // lleva motivo, que es lo que después se le reclama y lo que ajusta la
    // especificación de la siguiente compra.
    const cantidadRechazada = item.cantidadRechazada ?? 0;
    if (typeof cantidadRechazada !== "number" || !Number.isFinite(cantidadRechazada) || cantidadRechazada < 0) throw new ErrorRecepcion("La cantidad rechazada debe ser un número mayor o igual a cero");
    const motivoRechazo = cantidadRechazada > 0 ? item.motivoRechazo : "";
    if (cantidadRechazada > 0 && !MOTIVOS_RECHAZO.includes(motivoRechazo)) throw new ErrorRecepcion("Indica el motivo de cada producto rechazado");
    return {...item, notaRecepcion: (item.notaRecepcion ?? "").trim(), cantidadRechazada, motivoRechazo};
  });
}
export function validarProductosRecepcion(entradas: EntradaRecepcion[], items: {productoId: unknown}[]) {
  if (entradas.length !== items.length || entradas.some((entrada) => !items.some((item) => String(item.productoId) === entrada.productoId))) throw new ErrorRecepcion("Debes enviar todos los productos del documento, sin agregar productos ajenos");
}
