// Número de caja de cada computadora del mostrador.
//
// Una sucursal tiene varias cajas y cada caja es UNA computadora, con su
// báscula, su escáner y su terminal. Cada caja lleva su propio fondo, efectivo,
// retiros y corte.
//
// La computadora se identifica con una cookie httpOnly que pone el servidor
// (`titos_computadora`) al asignarle su caja; el número sale de esa asignación
// (EquipoCaja.computadoraHash), no de algo que el navegador pueda editar. Dos
// computadoras no pueden ser la misma caja: ver lib/cajaComputadora.
//
// Las sesiones de caja anteriores a que hubiera varias cajas no traen número y
// cuentan como Caja 1.
//
// Este archivo no importa modelos: lo usan tanto el servidor como el navegador.

export const COOKIE_COMPUTADORA = "titos_computadora";
export const NUMERO_CAJA_MAXIMO = 30;

/** Número válido (1 a NUMERO_CAJA_MAXIMO) o null. */
export function normalizarNumeroCaja(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= NUMERO_CAJA_MAXIMO ? n : null;
}

/**
 * Filtro de la sesión abierta de UNA caja. La Caja 1 también encuentra las
 * sesiones sin número (abiertas antes de este cambio). Sin número de caja (la
 * computadora no tiene caja asignada) no encuentra ninguna.
 */
export function filtroCajaAbierta(ctx: { sucursalId: unknown; numeroCaja?: number | null }) {
  const numero = ctx.numeroCaja ?? null;
  return {
    sucursalId: ctx.sucursalId,
    estado: "abierta" as const,
    numeroCaja: numero === null ? -1 : numero === 1 ? { $in: [1, null] } : numero,
  };
}

/** Condición sobre `numeroCaja` de EquipoCaja: la Caja 1 incluye el registro viejo sin número. */
export function condicionNumeroCaja(numero: number) {
  return numero === 1 ? { $in: [1, null] } : numero;
}
