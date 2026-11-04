// Candados de temporada (minuta del 28 de octubre). Un producto de temporada
// (rosca, calabaza, ponche…) se maneja normal dentro de sus fechas. Fuera de
// ellas, en cuanto se agota en el CEDIS queda bloqueado: las tiendas ya no lo
// piden y no genera compras por mínimo. Se reactiva solo al llegar su fecha de
// inicio. Sin dependencias de servidor: lo usan las pantallas.

export type Temporada = { activa?: boolean | null; inicio?: string | null; fin?: string | null };

export type EstadoTemporada = "sin_temporada" | "en_temporada" | "fuera_con_existencia" | "bloqueado";

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function fechaTemporadaValida(valor: unknown): valor is string {
  return typeof valor === "string" && MMDD.test(valor);
}

/** "MM-DD" de una fecha YYYY-MM-DD. */
const mesDia = (fecha: string) => fecha.slice(5, 10);

/** true si `fecha` (YYYY-MM-DD) cae entre inicio y fin; soporta temporadas que cruzan el año (dic → ene). */
export function enTemporada(t: Temporada, fecha: string) {
  if (!t.activa || !fechaTemporadaValida(t.inicio) || !fechaTemporadaValida(t.fin)) return true;
  const hoy = mesDia(fecha);
  return t.inicio <= t.fin ? hoy >= t.inicio && hoy <= t.fin : hoy >= t.inicio || hoy <= t.fin;
}

export function estadoTemporada(t: Temporada | null | undefined, fecha: string, existencia: number): EstadoTemporada {
  if (!t?.activa || !fechaTemporadaValida(t.inicio) || !fechaTemporadaValida(t.fin)) return "sin_temporada";
  if (enTemporada(t, fecha)) return "en_temporada";
  return existencia > 0 ? "fuera_con_existencia" : "bloqueado";
}

export const ESTADO_TEMPORADA_LABEL: Record<EstadoTemporada, string> = {
  sin_temporada: "Todo el año",
  en_temporada: "En temporada",
  fuera_con_existencia: "Fuera de temporada (se vende lo que queda)",
  bloqueado: "Bloqueado hasta su temporada",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "15 dic" a partir de "12-15". */
export function textoMesDia(mmdd: string | null | undefined) {
  if (!fechaTemporadaValida(mmdd)) return "";
  return `${Number(mmdd.slice(3))} ${MESES[Number(mmdd.slice(0, 2)) - 1]}`;
}

/** true el día en que empieza la temporada: ese día se manda el aviso de reactivación. */
export function iniciaHoy(t: Temporada | null | undefined, fecha: string) {
  return !!t?.activa && fechaTemporadaValida(t.inicio) && mesDia(fecha) === t.inicio;
}
