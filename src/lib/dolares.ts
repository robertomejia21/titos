// Reglas con las que el punto de venta recibe dólares en billete.
//
// Vive aparte de `lib/configuracion` (que abre la base de datos) porque estas
// mismas reglas las evalúa el navegador para avisarle al cajero antes de
// cobrar. Quien manda sigue siendo el servidor: la API las vuelve a aplicar.

export type ReglasDolares = {
  aceptaPagos: boolean;
  denominacionMaxima: number;
  porcentajeMaximo: number;
  montoMaximoUsd: number;
};

/** Reglas vigentes, con los valores por omisión de las tiendas que no las han tocado. */
export function reglasDolaresDe(config: {
  dolares?: Partial<ReglasDolares> | null;
}): ReglasDolares {
  const dolares = config.dolares ?? {};
  return {
    aceptaPagos: dolares.aceptaPagos !== false,
    denominacionMaxima: Number(dolares.denominacionMaxima) || 0,
    porcentajeMaximo: Number(dolares.porcentajeMaximo) || 0,
    montoMaximoUsd: Number(dolares.montoMaximoUsd) || 0,
  };
}

/**
 * Máximo en pesos de una venta que puede cubrirse con billete verde. `null`
 * cuando no hay tope por porcentaje: la venta completa se puede pagar así.
 */
export function topeDolaresEnPesos(reglas: ReglasDolares, total: number): number | null {
  if (!(reglas.porcentajeMaximo > 0)) return null;
  return Math.round(((total * reglas.porcentajeMaximo) / 100) * 100) / 100;
}

/**
 * Revisa un cobro en dólares contra los dos topes configurados. Devuelve el
 * texto del error o `null` si pasa. Lo usan el punto de venta (para avisar
 * antes de cobrar) y la API (que es la que de verdad manda).
 */
export function motivoRechazoDolares({
  reglas,
  total,
  montoAplicado,
  montoUsd,
}: {
  reglas: ReglasDolares;
  /** Total de la venta, en pesos. */
  total: number;
  /** Parte del total que se está cubriendo con dólares, en pesos. */
  montoAplicado: number;
  /** Billetes que entregó el cliente, en dólares. */
  montoUsd: number;
}): string | null {
  if (montoAplicado <= 0) return null;

  if (!reglas.aceptaPagos) return "Por ahora no se están recibiendo pagos en dólares.";

  const tope = topeDolaresEnPesos(reglas, total);
  // El centavo de tolerancia es el mismo que usa el resto del cobro: un tope de
  // 40% sobre 333.33 no debe rebotar por medio centavo de redondeo.
  if (tope != null && montoAplicado - tope > 0.01) {
    return (
      `Solo se puede pagar hasta el ${reglas.porcentajeMaximo}% de la venta en dólares ` +
      `(${tope.toFixed(2)} pesos de ${total.toFixed(2)}). El resto se cobra en otra forma de pago.`
    );
  }

  if (reglas.montoMaximoUsd > 0 && montoUsd - reglas.montoMaximoUsd > 0.01) {
    return `No se reciben más de ${reglas.montoMaximoUsd.toFixed(2)} USD en una sola venta.`;
  }

  return null;
}
