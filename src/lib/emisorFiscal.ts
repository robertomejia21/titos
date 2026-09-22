// Datos fiscales de la empresa que emite las facturas. Hasta ahora el sistema
// solo guardaba los del receptor: para timbrar hacen falta también los del
// emisor, y el SAT los valida contra el CSD, así que un dedazo aquí rebota
// todas las facturas.
//
// Este archivo lo consumen componentes de cliente, así que no importa mongoose.

import { esRfcValido, normalizarRfc, REGIMENES_FISCALES_VALORES } from "./facturacion";

export type EmisorFiscal = {
  /** RFC de la empresa. Debe ser el mismo con el que está emitido el CSD. */
  rfc: string;
  /** Razón social tal como viene en la Constancia de Situación Fiscal, sin el
   *  régimen de capital ("S.A. DE C.V."), que el SAT no quiere en el nombre. */
  razonSocial: string;
  regimenFiscal: string;
  /** CP del domicilio fiscal. Es el LugarExpedicion por defecto del CFDI. */
  codigoPostal: string;
};

export const EMISOR_VACIO: EmisorFiscal = {
  rfc: "",
  razonSocial: "",
  regimenFiscal: "",
  codigoPostal: "",
};

/**
 * Lee los datos del emisor vengan de donde vengan.
 *
 * No se puede hacer `{...config.emisorFiscal}`: cuando la configuración llega
 * como documento de Mongoose, eso es un subdocumento y el spread copia sus
 * propiedades internas ($__, _doc, $basePath) en vez de los campos, dejando el
 * emisor vacío y haciendo creer que nunca se capturó. Aquí se leen por nombre,
 * que funciona igual con documento, subdocumento u objeto plano.
 */
export function emisorDesde(valor: unknown): EmisorFiscal {
  const e = (valor ?? {}) as Partial<EmisorFiscal>;
  return {
    rfc: e.rfc ?? "",
    razonSocial: e.razonSocial ?? "",
    regimenFiscal: e.regimenFiscal ?? "",
    codigoPostal: e.codigoPostal ?? "",
  };
}

/** True cuando ya hay datos suficientes para armar el nodo Emisor del CFDI. */
export function emisorCompleto(emisor: EmisorFiscal | null | undefined) {
  return Boolean(
    emisor?.rfc && emisor.razonSocial && emisor.regimenFiscal && emisor.codigoPostal,
  );
}

export function validarEmisorFiscal(valor: unknown): EmisorFiscal {
  if (!valor || typeof valor !== "object")
    throw new Error("Revisa los datos fiscales de la empresa.");
  const e = valor as EmisorFiscal;

  const rfc = normalizarRfc(String(e.rfc ?? ""));
  const razonSocial = String(e.razonSocial ?? "").trim();
  const regimenFiscal = String(e.regimenFiscal ?? "").trim();
  const codigoPostal = String(e.codigoPostal ?? "").trim();

  // Se permite guardar todo vacío: es el estado inicial, antes de capturarlo.
  if (!rfc && !razonSocial && !regimenFiscal && !codigoPostal) return EMISOR_VACIO;

  if (!esRfcValido(rfc)) throw new Error("El RFC de la empresa no es válido.");
  if (!razonSocial) throw new Error("Captura la razón social de la empresa.");
  if (!(REGIMENES_FISCALES_VALORES as readonly string[]).includes(regimenFiscal))
    throw new Error("Elige el régimen fiscal de la empresa.");
  if (!/^\d{5}$/.test(codigoPostal))
    throw new Error("El código postal de la empresa debe tener cinco dígitos.");

  return { rfc, razonSocial: razonSocial.toUpperCase(), regimenFiscal, codigoPostal };
}
