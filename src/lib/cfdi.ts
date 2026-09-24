// Traduce una Factura del sistema al JSON de CFDI 4.0 que recibe el PAC.
//
// Regla de oro: este archivo NO adivina. Si a un producto le falta el dato
// fiscal, o los impuestos calculados no cuadran con el total de la factura,
// levanta ErrorCfdi y no se timbra. Un CFDI timbrado con datos malos no se
// edita: se cancela y se vuelve a emitir, y fuera del mes en curso la
// cancelación necesita que el receptor la acepte.
//
// Los impuestos salen de Producto.fiscal (IVA, IEPS y clave SAT por producto),
// no de la tasa global de Configuracion: el SAT valida el desglose renglón por
// renglón y en el abarrote conviven tasa 0, 16% y exento en el mismo ticket.

import type { CfdiJson } from "./sw";
import type { EmisorFiscal } from "./emisorFiscal";
import { emisorCompleto } from "./emisorFiscal";
import type { FiscalProducto } from "./fiscalProducto";
import { CLAVE_PROD_SERV_GENERICA } from "./facturas";

/** Diferencia máxima tolerada entre lo calculado y el total de la factura. */
const TOLERANCIA_CENTAVOS = 0.02;

const IVA = "002";
const IEPS = "003";

export class ErrorCfdi extends Error {
  /** Todo lo que está mal, junto. Corregir de uno en uno es insufrible. */
  readonly problemas: string[];
  constructor(problemas: string[]) {
    super(problemas.join(" "));
    this.name = "ErrorCfdi";
    this.problemas = problemas;
  }
}

/** Importe en pesos con los dos decimales que exige el CFDI. */
function money(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Tasa con los seis decimales que exige el CFDI (0.160000). */
function tasa(n: number) {
  return n.toFixed(6);
}

function redondear(n: number) {
  return Math.round(n * 100) / 100;
}

export type ConceptoFacturaLike = {
  productoId?: unknown;
  claveProdServ?: string;
  claveUnidad?: string;
  sku?: string;
  descripcion: string;
  unidad?: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
};

export type FacturaLike = {
  serie?: string;
  folio: string;
  ventaFecha?: Date | string | null;
  createdAt?: Date | string;
  conceptos: ConceptoFacturaLike[];
  total: number;
  formaPago: string;
  metodoPago: string;
  receptor: {
    razonSocial: string;
    rfc: string;
    regimenFiscal: string;
    usoCfdi: string;
    codigoPostal: string;
  };
};

/** Datos fiscales de los productos de la factura, por id de producto. */
export type FiscalPorProducto = Map<string, FiscalProducto>;

type ImpuestoCalculado = {
  impuesto: string;
  base: number;
  importe: number;
  tasaOCuota: number;
  tipoFactor: "Tasa" | "Cuota" | "Exento";
};

/**
 * Impuestos de un renglón a partir de los datos fiscales de su producto.
 * Devuelve también `objetoImp`, que es el campo con el que el CFDI 4.0 declara
 * si el concepto causa impuestos.
 */
function impuestosDelConcepto(
  concepto: ConceptoFacturaLike,
  fiscal: FiscalProducto | undefined,
  problemas: string[],
): { traslados: ImpuestoCalculado[]; objetoImp: "01" | "02" } {
  const etiqueta = `"${concepto.descripcion}"`;

  if (!fiscal) {
    problemas.push(`${etiqueta} no tiene datos fiscales capturados.`);
    return { traslados: [], objetoImp: "01" };
  }
  if (fiscal.iva === "pendiente") {
    problemas.push(`${etiqueta} tiene el IVA pendiente de confirmar.`);
    return { traslados: [], objetoImp: "01" };
  }
  if (fiscal.iepsTipo === "pendiente") {
    problemas.push(`${etiqueta} tiene el IEPS pendiente de confirmar.`);
    return { traslados: [], objetoImp: "01" };
  }
  // El 8% es el estímulo de franja fronteriza y el SAT solo lo acepta en claves
  // del catálogo marcadas para él; la genérica 01010101 no lo está. Sin esto el
  // PAC contesta "CFDI40999 - Error no clasificado".
  const clave = fiscal.claveProdServ || concepto.claveProdServ || CLAVE_PROD_SERV_GENERICA;
  if (fiscal.iva === "8" && clave === CLAVE_PROD_SERV_GENERICA)
    problemas.push(
      `${etiqueta} lleva IVA 8% (franja fronteriza) y necesita su clave de producto SAT: la genérica 01010101 no admite el estímulo. Captúrala en Productos.`,
    );

  const base = redondear(concepto.importe);
  const traslados: ImpuestoCalculado[] = [];

  // El IEPS va primero porque el IVA se calcula sobre la base más el IEPS.
  let baseIva = base;
  if (fiscal.iepsTipo === "porcentaje" && fiscal.iepsValor > 0) {
    const importe = redondear(base * (fiscal.iepsValor / 100));
    traslados.push({
      impuesto: IEPS,
      base,
      importe,
      tasaOCuota: fiscal.iepsValor / 100,
      tipoFactor: "Tasa",
    });
    baseIva = redondear(base + importe);
  } else if (fiscal.iepsTipo === "cuota" && fiscal.iepsValor > 0) {
    const importe = redondear(fiscal.iepsValor * concepto.cantidad);
    traslados.push({
      impuesto: IEPS,
      base,
      importe,
      tasaOCuota: fiscal.iepsValor,
      tipoFactor: "Cuota",
    });
    baseIva = redondear(base + importe);
  }

  if (fiscal.iva === "exento") {
    // Un concepto exento sí es objeto de impuesto: lleva el nodo con
    // TipoFactor "Exento" y, a diferencia de los demás, sin TasaOCuota ni
    // Importe. Por eso se marca aparte y no como "no objeto".
    traslados.push({ impuesto: IVA, base: baseIva, importe: 0, tasaOCuota: 0, tipoFactor: "Exento" });
    return { traslados, objetoImp: "02" };
  }

  const tasaIva = Number(fiscal.iva) / 100;
  traslados.push({
    impuesto: IVA,
    base: baseIva,
    importe: redondear(baseIva * tasaIva),
    tasaOCuota: tasaIva,
    tipoFactor: "Tasa",
  });
  return { traslados, objetoImp: "02" };
}

/** Fecha de emisión en el formato del CFDI, sin zona horaria ni milisegundos. */
function fechaCfdi(valor: Date | string | null | undefined) {
  const fecha = valor ? new Date(valor) : new Date();
  const base = Number.isNaN(fecha.getTime()) ? new Date() : fecha;
  // El SAT rechaza comprobantes con fecha futura y tolera hasta 72 horas de
  // atraso. Una factura vieja se timbra con la hora de emisión, no con la de
  // la venta, y quien la emite ya sabe que está fuera de plazo.
  const ahora = new Date();
  const usada = base > ahora ? ahora : base;
  const local = new Date(usada.getTime() - usada.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

/**
 * Arma el CFDI 4.0 de una factura.
 *
 * @param factura   Factura del sistema, ya generada y revisada.
 * @param emisor    Datos fiscales de la empresa (Configuracion.emisorFiscal).
 * @param fiscales  Datos fiscales de los productos, por id.
 * @param opts.lugarExpedicion CP de la sucursal; si va vacío se usa el del emisor.
 * @throws ErrorCfdi con la lista completa de lo que falta o no cuadra.
 */
export function construirCfdi(
  factura: FacturaLike,
  emisor: EmisorFiscal,
  fiscales: FiscalPorProducto,
  opts: { lugarExpedicion?: string } = {},
): CfdiJson {
  const problemas: string[] = [];

  if (!emisorCompleto(emisor))
    problemas.push(
      "Faltan los datos fiscales de la empresa (RFC, razón social, régimen y CP) en Configuración.",
    );

  const r = factura.receptor;
  if (!r?.rfc) problemas.push("La factura no tiene RFC del receptor.");
  if (!r?.razonSocial) problemas.push("La factura no tiene razón social del receptor.");
  if (!r?.regimenFiscal) problemas.push("Falta el régimen fiscal del receptor.");
  if (!r?.usoCfdi) problemas.push("Falta el uso de CFDI del receptor.");
  if (!/^\d{5}$/.test(r?.codigoPostal ?? ""))
    problemas.push("El código postal del receptor debe tener cinco dígitos.");
  if (!factura.conceptos?.length) problemas.push("La factura no tiene conceptos.");

  const lugarExpedicion = opts.lugarExpedicion || emisor.codigoPostal;
  if (lugarExpedicion && !/^\d{5}$/.test(lugarExpedicion))
    problemas.push("El código postal de expedición debe tener cinco dígitos.");

  // Totales por impuesto, para el nodo Impuestos del comprobante.
  const totales = new Map<
    string,
    { impuesto: string; base: number; importe: number; tasaOCuota: number; tipoFactor: string }
  >();
  let subtotal = 0;
  let totalTrasladado = 0;

  const conceptos = (factura.conceptos ?? []).map((concepto) => {
    const id = concepto.productoId ? String(concepto.productoId) : "";
    const fiscal = id ? fiscales.get(id) : undefined;
    const { traslados, objetoImp } = impuestosDelConcepto(concepto, fiscal, problemas);

    subtotal = redondear(subtotal + concepto.importe);

    const trasladosCfdi = traslados.map((t) => {
      if (t.tipoFactor === "Exento") {
        // El nodo exento del concepto no lleva Importe ni TasaOCuota, y no
        // suma a los totales del comprobante.
        return { Base: money(t.base), Impuesto: t.impuesto, TipoFactor: "Exento" };
      }
      totalTrasladado = redondear(totalTrasladado + t.importe);
      // Se agrupa por impuesto, factor y tasa: el SAT quiere un renglón por
      // combinación, no uno por concepto.
      const clave = `${t.impuesto}|${t.tipoFactor}|${t.tasaOCuota}`;
      const acumulado = totales.get(clave) ?? {
        impuesto: t.impuesto,
        base: 0,
        importe: 0,
        tasaOCuota: t.tasaOCuota,
        tipoFactor: t.tipoFactor,
      };
      acumulado.base = redondear(acumulado.base + t.base);
      acumulado.importe = redondear(acumulado.importe + t.importe);
      totales.set(clave, acumulado);
      return {
        Base: money(t.base),
        Importe: money(t.importe),
        Impuesto: t.impuesto,
        TasaOCuota: tasa(t.tasaOCuota),
        TipoFactor: t.tipoFactor,
      };
    });

    const salida: Record<string, unknown> = {
      ClaveProdServ: fiscal?.claveProdServ || concepto.claveProdServ || CLAVE_PROD_SERV_GENERICA,
      Cantidad: String(concepto.cantidad),
      ClaveUnidad: concepto.claveUnidad || "H87",
      Descripcion: concepto.descripcion,
      ValorUnitario: money(concepto.valorUnitario),
      Importe: money(concepto.importe),
      ObjetoImp: objetoImp,
    };
    if (concepto.sku) salida.NoIdentificacion = concepto.sku;
    if (concepto.unidad) salida.Unidad = concepto.unidad;
    if (trasladosCfdi.length) salida.Impuestos = { Traslados: trasladosCfdi };
    return salida;
  });

  // El cuadre. Es lo que impide timbrar una factura cuyo total se calculó con
  // la tasa global vieja mientras los productos ya tienen tasas distintas.
  const totalCalculado = redondear(subtotal + totalTrasladado);
  if (
    !problemas.length &&
    Math.abs(totalCalculado - redondear(factura.total)) > TOLERANCIA_CENTAVOS
  )
    problemas.push(
      `Los impuestos por producto dan ${money(totalCalculado)} y la factura dice ${money(factura.total)}. ` +
        "Revisa las tasas de los productos o vuelve a generar la factura antes de timbrar.",
    );

  if (problemas.length) throw new ErrorCfdi(problemas);

  const cfdi: Record<string, unknown> = {
    Version: "4.0",
    Serie: factura.serie || "A",
    Folio: factura.folio,
    Fecha: fechaCfdi(factura.ventaFecha ?? factura.createdAt),
    FormaPago: factura.formaPago,
    MetodoPago: factura.metodoPago,
    // Vacíos a propósito: el PAC sella con el CSD cargado en la cuenta.
    Sello: "",
    NoCertificado: "",
    Certificado: "",
    Moneda: "MXN",
    SubTotal: money(subtotal),
    Total: money(redondear(factura.total)),
    TipoDeComprobante: "I",
    Exportacion: "01",
    LugarExpedicion: lugarExpedicion,
    Emisor: {
      Rfc: emisor.rfc,
      Nombre: emisor.razonSocial,
      RegimenFiscal: emisor.regimenFiscal,
    },
    Receptor: {
      Rfc: r.rfc,
      Nombre: r.razonSocial.toUpperCase(),
      DomicilioFiscalReceptor: r.codigoPostal,
      RegimenFiscalReceptor: r.regimenFiscal,
      UsoCFDI: r.usoCfdi,
    },
    Conceptos: conceptos,
  };

  // El nodo Impuestos solo existe si algo se trasladó. Una factura enteramente
  // exenta o de tasa 0 sin IEPS no lo lleva, y mandarlo en ceros la rechaza.
  if (totales.size) {
    cfdi.Impuestos = {
      TotalImpuestosTrasladados: money(totalTrasladado),
      Traslados: [...totales.values()].map((t) => ({
        Base: money(t.base),
        Importe: money(t.importe),
        Impuesto: t.impuesto,
        TasaOCuota: tasa(t.tasaOCuota),
        TipoFactor: t.tipoFactor,
      })),
    };
  }
  // Si nada se trasladó el comprobante va sin nodo Impuestos. Eso solo pasa
  // cuando todo es exento: la tasa 0 sí traslada, con importe cero, y ahí el
  // nodo debe ir sumando 0.00.

  return cfdi;
}
