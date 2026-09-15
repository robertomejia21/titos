export const REGLAS_OPERACION = {
  costosCompra: "pendiente",
  baseIvaCompra: "pendiente",
  turnoAnterior: "advertir",
  permitirCorreccionDia: false,
} as const;

export type ReglasOperacion = {
  costosCompra: "pendiente" | "sin_impuestos" | "incluidos";
  baseIvaCompra: "pendiente" | "costo" | "costo_ieps";
  turnoAnterior: "advertir" | "bloquear";
  permitirCorreccionDia: boolean;
};

export function validarReglasOperacion(value: unknown): ReglasOperacion {
  if (!value || typeof value !== "object") throw new Error("Revisa las reglas de operación.");
  const r = value as ReglasOperacion;
  if (!["pendiente", "sin_impuestos", "incluidos"].includes(r.costosCompra) ||
      !["pendiente", "costo", "costo_ieps"].includes(r.baseIvaCompra) ||
      !["advertir", "bloquear"].includes(r.turnoAnterior)) throw new Error("Elige una opción válida para cada regla.");
  if (r.permitirCorreccionDia != null && typeof r.permitirCorreccionDia !== "boolean") throw new Error("Revisa el permiso para corregir el día.");
  return { costosCompra: r.costosCompra, baseIvaCompra: r.baseIvaCompra, turnoAnterior: r.turnoAnterior, permitirCorreccionDia: r.permitirCorreccionDia ?? false };
}
