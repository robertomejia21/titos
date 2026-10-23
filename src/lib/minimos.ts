// Mínimos y máximos del CEDIS expresados en la presentación con la que se
// compra (piezas, cajas, tarimas) y ajustados por temporada alta.
//
// Los mínimos se siguen guardando en la unidad base del producto (pieza o kg),
// que es la que usan el inventario y los pedidos; la caja y la tarima son solo
// la forma de capturarlos y leerlos.

export type ProductoMinimo = {
  stockMinimo?: number | null;
  stockMaximo?: number | null;
  minimoTemporadaAlta?: number | null;
  piezasPorCaja?: number | null;
  cajasPorTarima?: number | null;
  unidad?: string | null;
};

export type ReglasTemporada = { meses?: number[] | null; factorMinimos?: number | null };

/** Mes 1-12 de una fecha YYYY-MM-DD. */
export function mesDe(ymd: string) {
  return Number(ymd.slice(5, 7));
}

export function esTemporadaAlta(ymd: string, reglas: ReglasTemporada | null | undefined) {
  return (reglas?.meses ?? []).includes(mesDe(ymd));
}

/**
 * Mínimo que rige hoy. En temporada alta gana el mínimo de temporada del
 * producto; si no lo tiene, el mínimo normal por el factor de temporada
 * (redondeado a caja completa cuando el producto se maneja por caja).
 */
export function minimoVigente(producto: ProductoMinimo, ymd: string, reglas: ReglasTemporada | null | undefined) {
  const normal = producto.stockMinimo ?? 0;
  if (!esTemporadaAlta(ymd, reglas)) return normal;
  if ((producto.minimoTemporadaAlta ?? 0) > 0) return producto.minimoTemporadaAlta!;
  const factor = reglas?.factorMinimos ?? 1;
  const crudo = normal * factor;
  const caja = producto.piezasPorCaja ?? 0;
  return caja > 1 ? Math.ceil(crudo / caja) * caja : Math.ceil(crudo);
}

/** El máximo crece en la misma proporción que el mínimo, para no topar la compra de diciembre. */
export function maximoVigente(producto: ProductoMinimo, ymd: string, reglas: ReglasTemporada | null | undefined) {
  const maximo = producto.stockMaximo ?? 0;
  const normal = producto.stockMinimo ?? 0;
  if (!esTemporadaAlta(ymd, reglas) || maximo <= 0) return maximo;
  const minimo = minimoVigente(producto, ymd, reglas);
  if (normal <= 0) return Math.max(maximo, minimo);
  return Math.max(minimo, Math.ceil(maximo * (minimo / normal)));
}

/** "20 cajas (240 pzas)", "1 tarima + 4 cajas", "35 kg". */
export function enPresentacion(cantidad: number, producto: ProductoMinimo) {
  const unidad = producto.unidad === "kg" ? "kg" : "pzas";
  const caja = producto.piezasPorCaja ?? 0;
  if (caja <= 1) return `${redondear(cantidad)} ${unidad}`;
  const cajas = cantidad / caja;
  const tarima = producto.cajasPorTarima ?? 0;
  if (tarima > 0 && cajas >= tarima) {
    const tarimas = Math.floor(cajas / tarima);
    const resto = redondear(cajas - tarimas * tarima);
    return `${tarimas} tarima${tarimas === 1 ? "" : "s"}${resto ? ` + ${resto} caja${resto === 1 ? "" : "s"}` : ""} (${redondear(cantidad)} ${unidad})`;
  }
  const c = redondear(cajas);
  return `${c} caja${c === 1 ? "" : "s"} (${redondear(cantidad)} ${unidad})`;
}

/**
 * Cuánto pedir para volver al máximo, redondeado hacia arriba a caja completa:
 * al proveedor no se le piden 7 piezas de una caja de 12.
 */
export function cantidadAResurtir(existencia: number, minimo: number, maximo: number, producto: ProductoMinimo) {
  const objetivo = Math.max(maximo, minimo);
  const falta = Math.max(0, objetivo - Math.max(0, existencia));
  const caja = producto.piezasPorCaja ?? 0;
  return caja > 1 ? Math.ceil(falta / caja) * caja : Math.ceil(falta);
}

function redondear(n: number) {
  return Math.round(n * 100) / 100;
}
