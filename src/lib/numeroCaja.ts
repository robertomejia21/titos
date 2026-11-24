// Número de caja de cada computadora del mostrador.
//
// Una sucursal puede tener varias cajas, y cada una lleva su propio fondo,
// efectivo, retiros y corte. La caja la identifica la COMPUTADORA, no el
// cajero: se marca una vez ("esta es la Caja 2") y se guarda en una cookie del
// navegador. Al ir en cookie viaja sola en cada petición, también en las
// operaciones que se encolaron sin internet y se sincronizan después.
//
// Sin cookie se asume la Caja 1, que es exactamente como funcionaba todo antes
// de que existieran varias cajas: las sesiones viejas no traen número y se
// tratan como Caja 1.
//
// Este archivo no importa modelos: lo usan tanto el servidor como el navegador.

export const COOKIE_NUMERO_CAJA = "titos_caja";
export const NUMERO_CAJA_MAXIMO = 30;

/** Número válido (1 a NUMERO_CAJA_MAXIMO) o null. */
export function normalizarNumeroCaja(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= NUMERO_CAJA_MAXIMO ? n : null;
}

/** Número de caja de la petición (cookie del equipo); 1 si no trae. */
export function numeroCajaDe(req?: { cookies: { get(nombre: string): { value: string } | undefined } } | null): number {
  return normalizarNumeroCaja(req?.cookies.get(COOKIE_NUMERO_CAJA)?.value) ?? 1;
}

/**
 * Filtro de la sesión abierta de UNA caja. La Caja 1 también encuentra las
 * sesiones sin número (abiertas antes de este cambio).
 */
export function filtroCajaAbierta(ctx: { sucursalId: unknown; numeroCaja?: number }) {
  const numero = ctx.numeroCaja ?? 1;
  return {
    sucursalId: ctx.sucursalId,
    estado: "abierta" as const,
    numeroCaja: numero === 1 ? { $in: [1, null] } : numero,
  };
}

// ---------- Navegador ----------

/** Número guardado en esta computadora, o null si todavía no se ha elegido. */
export function leerNumeroCajaEquipo(): number | null {
  if (typeof document === "undefined") return null;
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_NUMERO_CAJA}=`));
  return par ? normalizarNumeroCaja(decodeURIComponent(par.split("=")[1] ?? "")) : null;
}

export function guardarNumeroCajaEquipo(numero: number) {
  const n = normalizarNumeroCaja(numero);
  if (!n) return;
  // Diez años: es una marca del equipo, no de la sesión del usuario.
  document.cookie = `${COOKIE_NUMERO_CAJA}=${n}; path=/; max-age=${60 * 60 * 24 * 365 * 10}; SameSite=Lax`;
}
