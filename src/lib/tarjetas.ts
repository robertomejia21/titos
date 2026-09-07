// Tipos de tarjeta con los que se cobra en el punto de venta.
//
// El banco liquida cada uno por separado y con comisiones distintas: el débito
// deposita casi en el acto, el crédito a las 24/48 h y American Express va por
// su propio contrato. Sin distinguirlos, el corte cuadra contra la terminal
// pero no contra lo que realmente cae en la cuenta.
//
// No se deduce del plástico a propósito: el BIN dice la marca (Visa, MC, Amex)
// pero NO si es de crédito o de débito, y adivinarlo mandaría el depósito al
// renglón equivocado. Lo único que sí se puede leer de la banda es que una
// tarjeta que empieza en 34 o 37 es American Express, y eso se usa nada más
// para preseleccionar la opción; el cajero siempre puede corregirla.

export const TIPOS_TARJETA = ["credito", "debito", "amex"] as const;

export type TipoTarjeta = (typeof TIPOS_TARJETA)[number];

export const ETIQUETA_TIPO_TARJETA: Record<TipoTarjeta, string> = {
  credito: "Crédito",
  debito: "Débito",
  amex: "American Express",
};

/** Nombre corto para el ticket térmico, donde el renglón mide 32 caracteres. */
export const ETIQUETA_TIPO_TARJETA_CORTA: Record<TipoTarjeta, string> = {
  credito: "Crédito",
  debito: "Débito",
  amex: "AMEX",
};

export function esTipoTarjeta(valor: unknown): valor is TipoTarjeta {
  return typeof valor === "string" && (TIPOS_TARJETA as readonly string[]).includes(valor);
}

/**
 * Etiqueta de un cobro con tarjeta. Las ventas anteriores a esta versión no
 * traen el dato: se muestran como no identificadas en vez de inventarles un
 * tipo, igual que se hace con las terminales y los emisores de vales.
 */
export function etiquetaTipoTarjeta(tipo?: string | null) {
  return esTipoTarjeta(tipo) ? ETIQUETA_TIPO_TARJETA[tipo] : "Sin tipo identificado";
}

/**
 * Único tipo que sí se puede deducir del número: American Express usa los
 * prefijos 34 y 37. Sirve para preseleccionar la opción cuando el cajero pasa
 * la tarjeta por el lector; devuelve null para todo lo demás porque el BIN no
 * distingue crédito de débito.
 */
export function tipoTarjetaPorPan(pan: string): TipoTarjeta | null {
  const digitos = (pan ?? "").replace(/\D/g, "");
  if (/^3[47]/.test(digitos)) return "amex";
  return null;
}
