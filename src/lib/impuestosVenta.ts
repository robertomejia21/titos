// Impuestos de un renglón de venta a partir de los datos fiscales del producto.
//
// Hay dos mundos, y el que manda es el campo `precioImpuestos` del producto:
//
//   "sin_impuestos" → el precio del catálogo es la base y los impuestos se
//                     SUMAN al cobrar. La caja cobra más que el precio de lista.
//   "incluidos"     → el precio ya los trae adentro. La caja cobra el precio tal
//                     cual y aquí solo se separa cuánto de eso era impuesto,
//                     para que la factura lo pueda desglosar.
//   "pendiente"     → nadie lo ha definido. Se cobra el precio sin tocarlo y se
//                     marca `sinDatos`: la tienda no deja de vender por un dato
//                     de catálogo incompleto, pero esa venta no se podrá timbrar
//                     hasta que se complete.
//
// El IEPS va antes que el IVA porque el IVA se calcula sobre la base más el
// IEPS, no sobre la base sola.

import type { FiscalProducto } from "./fiscalProducto";

export type ImpuestosLinea = {
  /** Lo que se le cobra al cliente por este renglón. */
  total: number;
  /** Base gravable: el importe sin impuestos. */
  base: number;
  ieps: number;
  iva: number;
  /** Suma de impuestos del renglón. */
  impuestos: number;
  /** True cuando faltan datos fiscales y se cobró sin impuesto. */
  sinDatos: boolean;
};

function redondear(n: number) {
  return Math.round(n * 100) / 100;
}

/** Tasa de IVA como fracción. "exento" y "0" son cero, pero no son lo mismo. */
function tasaIva(fiscal: FiscalProducto) {
  return fiscal.iva === "exento" ? 0 : Number(fiscal.iva) / 100;
}

/**
 * Calcula los impuestos de un renglón ya con promociones aplicadas.
 *
 * @param importe  Importe del renglón según el catálogo y las promociones.
 * @param cantidad Piezas o kilos; solo se usa para el IEPS de cuota fija.
 * @param fiscal   Datos fiscales del producto, o undefined si no tiene.
 */
export function impuestosDeLinea(
  importe: number,
  cantidad: number,
  fiscal: FiscalProducto | undefined | null,
): ImpuestosLinea {
  const cobrado = redondear(importe);
  const sinImpuesto: ImpuestosLinea = {
    total: cobrado,
    base: cobrado,
    ieps: 0,
    iva: 0,
    impuestos: 0,
    sinDatos: true,
  };

  if (!fiscal) return sinImpuesto;
  if (fiscal.iva === "pendiente" || fiscal.iepsTipo === "pendiente") return sinImpuesto;
  if (fiscal.precioImpuestos === "pendiente") return sinImpuesto;

  const iva = tasaIva(fiscal);
  const iepsPorcentaje = fiscal.iepsTipo === "porcentaje" ? fiscal.iepsValor / 100 : 0;
  const iepsCuota = fiscal.iepsTipo === "cuota" ? fiscal.iepsValor * cantidad : 0;

  if (fiscal.precioImpuestos === "incluidos") {
    // El precio ya los trae: se despeja la base hacia atrás. Primero se quita
    // la cuota fija, que no escala con el precio, y luego se divide entre los
    // factores que sí.
    const sinCuota = cobrado - iepsCuota;
    const base = redondear(sinCuota / ((1 + iepsPorcentaje) * (1 + iva)));
    const ieps = redondear(base * iepsPorcentaje + iepsCuota);
    // El IVA absorbe el centavo del redondeo para que base + impuestos dé
    // exactamente lo cobrado: si no cuadra, el CFDI se rechaza por un centavo.
    const impuestoIva = redondear(cobrado - base - ieps);
    return {
      total: cobrado,
      base,
      ieps,
      iva: impuestoIva,
      impuestos: redondear(ieps + impuestoIva),
      sinDatos: false,
    };
  }

  // "sin_impuestos": el precio es la base y los impuestos se suman encima.
  const base = cobrado;
  const ieps = redondear(base * iepsPorcentaje + iepsCuota);
  const impuestoIva = redondear((base + ieps) * iva);
  const impuestos = redondear(ieps + impuestoIva);
  return {
    total: redondear(base + impuestos),
    base,
    ieps,
    iva: impuestoIva,
    impuestos,
    sinDatos: false,
  };
}

export type TotalesVenta = {
  /** Lo que paga el cliente. */
  total: number;
  base: number;
  ieps: number;
  iva: number;
  impuestos: number;
  /** Nombres de los productos que se cobraron sin impuesto por falta de datos. */
  sinDatosFiscales: string[];
};

/** Suma los renglones ya calculados en los totales de la venta. */
export function totalesDeVenta(
  lineas: { nombre: string; impuestos: ImpuestosLinea }[],
): TotalesVenta {
  const totales = lineas.reduce(
    (acc, l) => ({
      total: acc.total + l.impuestos.total,
      base: acc.base + l.impuestos.base,
      ieps: acc.ieps + l.impuestos.ieps,
      iva: acc.iva + l.impuestos.iva,
    }),
    { total: 0, base: 0, ieps: 0, iva: 0 },
  );
  return {
    total: redondear(totales.total),
    base: redondear(totales.base),
    ieps: redondear(totales.ieps),
    iva: redondear(totales.iva),
    impuestos: redondear(totales.ieps + totales.iva),
    sinDatosFiscales: lineas.filter((l) => l.impuestos.sinDatos).map((l) => l.nombre),
  };
}
