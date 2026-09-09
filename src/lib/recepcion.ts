export class ErrorRecepcion extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type EntradaRecepcion = {productoId: string; cantidadRecibida: number; pesoRecibidoKg?: number; notaRecepcion: string};
export function validarRecepcion(valor: unknown): EntradaRecepcion[] {
  if (!Array.isArray(valor) || !valor.length) throw new ErrorRecepcion("Captura todos los productos de la recepción");
  const ids = new Set<string>();
  return valor.map((item) => {
    if (!item || typeof item.productoId !== "string" || ids.has(item.productoId)) throw new ErrorRecepcion("Hay productos inválidos o repetidos");
    ids.add(item.productoId);
    if (typeof item.cantidadRecibida !== "number" || !Number.isFinite(item.cantidadRecibida) || item.cantidadRecibida < 0) throw new ErrorRecepcion("La cantidad recibida debe ser un número mayor o igual a cero");
    if (item.pesoRecibidoKg != null && (typeof item.pesoRecibidoKg !== "number" || !Number.isFinite(item.pesoRecibidoKg) || item.pesoRecibidoKg < 0)) throw new ErrorRecepcion("El peso recibido no es válido");
    if (item.notaRecepcion != null && (typeof item.notaRecepcion !== "string" || item.notaRecepcion.length > 1000)) throw new ErrorRecepcion("La nota admite hasta 1,000 caracteres");
    return {...item, notaRecepcion: (item.notaRecepcion ?? "").trim()};
  });
}
export function validarProductosRecepcion(entradas: EntradaRecepcion[], items: {productoId: unknown}[]) {
  if (entradas.length !== items.length || entradas.some((entrada) => !items.some((item) => String(item.productoId) === entrada.productoId))) throw new ErrorRecepcion("Debes enviar todos los productos del documento, sin agregar productos ajenos");
}
