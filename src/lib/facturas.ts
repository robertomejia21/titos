// Catálogos del SAT que ya se dejan capturados en la factura del sistema, para
// que en la fase de timbrado el CFDI salga sin volver a tocar los datos.
//
// Este archivo lo consumen también los componentes de cliente, así que no debe
// importar nada que arrastre mongoose al bundle del navegador.

function redondear(monto: number) {
  return Math.round(monto * 100) / 100;
}

export const FORMAS_PAGO_SAT = [
  { value: "01", label: "01 — Efectivo" },
  { value: "02", label: "02 — Cheque nominativo" },
  { value: "03", label: "03 — Transferencia electrónica de fondos" },
  { value: "04", label: "04 — Tarjeta de crédito" },
  { value: "08", label: "08 — Vales de despensa" },
  { value: "28", label: "28 — Tarjeta de débito" },
  { value: "99", label: "99 — Por definir" },
] as const;

export const METODOS_PAGO_SAT = [
  { value: "PUE", label: "PUE — Pago en una sola exhibición" },
  { value: "PPD", label: "PPD — Pago en parcialidades o diferido" },
] as const;

export const FORMAS_PAGO_SAT_VALORES = FORMAS_PAGO_SAT.map((f) => f.value);
export const METODOS_PAGO_SAT_VALORES = METODOS_PAGO_SAT.map((m) => m.value);

/**
 * Motivos de cancelación del SAT. Vive aquí y no junto al cliente del PAC
 * porque lo pinta un componente de cliente: el módulo que habla con SW no debe
 * acabar en el bundle del navegador.
 * El 01 exige además el UUID del comprobante que sustituye al cancelado.
 */
export const MOTIVOS_CANCELACION = [
  { value: "01", label: "01 — Comprobante emitido con errores con relación" },
  { value: "02", label: "02 — Comprobante emitido con errores sin relación" },
  { value: "03", label: "03 — No se llevó a cabo la operación" },
  { value: "04", label: "04 — Operación nominativa relacionada en la factura global" },
] as const;

export type MotivoCancelacion = (typeof MOTIVOS_CANCELACION)[number]["value"];

/** Clave genérica del SAT para productos que no están en el catálogo. */
export const CLAVE_PROD_SERV_GENERICA = "01010101";

/** Claves de unidad del SAT correspondientes a las unidades del catálogo interno. */
export const CLAVE_UNIDAD: Record<string, string> = { pieza: "H87", kg: "KGM" };

const FORMA_PAGO_POR_METODO: Record<string, string> = {
  efectivo: "01",
  // Los dólares en billete también son efectivo para el SAT; el CFDI se timbra
  // en pesos con el importe ya convertido.
  efectivo_usd: "01",
  transferencia: "03",
  tarjeta: "04",
  vales: "08",
  credito: "99",
};

export type PagoVentaLike = { metodoPago: string; monto: number };

/**
 * Traduce las formas de pago del punto de venta al catálogo del SAT. Una venta
 * con varias formas de pago se timbra como "99 — Por definir", que es lo que
 * marca la regla cuando no hay una sola forma identificable.
 */
export function formaPagoSat(pagos: PagoVentaLike[]) {
  if (pagos.length !== 1) return "99";
  return FORMA_PAGO_POR_METODO[pagos[0].metodoPago] ?? "99";
}

/** Una venta con parte a crédito se paga después, así que es PPD. */
export function metodoPagoSat(pagos: PagoVentaLike[]) {
  return pagos.some((p) => p.metodoPago === "credito") ? "PPD" : "PUE";
}

export type ItemVentaLike = {
  productoId?: unknown;
  sku: string;
  nombreProducto: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

export type ConceptoFactura = {
  productoId: unknown;
  claveProdServ: string;
  claveUnidad: string;
  sku: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
};

/**
 * Desglosa los renglones de la venta en conceptos de factura.
 *
 * Los precios del punto de venta ya llevan el IVA incluido, así que aquí se
 * separan: el valor unitario del concepto es el precio sin impuesto y el IVA se
 * calcula sobre la suma. La diferencia de centavos del redondeo se absorbe en el
 * IVA para que el total de la factura sea exactamente el de la venta.
 */
export function desglosarFactura(items: ItemVentaLike[], totalVenta: number, tasaIva: number) {
  const factor = 1 + tasaIva / 100;

  const conceptos: ConceptoFactura[] = items.map((item) => {
    const valorUnitario = redondear(item.precioUnitario / factor);
    return {
      productoId: item.productoId ?? null,
      claveProdServ: CLAVE_PROD_SERV_GENERICA,
      claveUnidad: CLAVE_UNIDAD[item.unidad] ?? "H87",
      sku: item.sku,
      descripcion: item.nombreProducto,
      unidad: item.unidad,
      cantidad: item.cantidad,
      valorUnitario,
      importe: redondear(valorUnitario * item.cantidad),
    };
  });

  const subtotal = redondear(conceptos.reduce((sum, c) => sum + c.importe, 0));
  const total = redondear(totalVenta);
  const iva = redondear(total - subtotal);

  return { conceptos, subtotal, iva, total };
}

export type ReceptorFactura = {
  razonSocial: string;
  rfc: string;
  regimenFiscal: string;
  usoCfdi: string;
  codigoPostal: string;
  direccionFiscal: string;
  emailFacturacion: string;
};

export const RECEPTOR_VACIO: ReceptorFactura = {
  razonSocial: "",
  rfc: "",
  regimenFiscal: "",
  usoCfdi: "",
  codigoPostal: "",
  direccionFiscal: "",
  emailFacturacion: "",
};
