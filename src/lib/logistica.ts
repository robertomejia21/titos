// Carga y salida de los folios del CEDIS (minuta del 28 de octubre): estados de
// cada caja, etapas de la pre-carga y el historial que alimenta la tarjeta
// digital del folio. Sin dependencias de servidor: lo usan las pantallas.

/**
 * Una caja se arma (se decide qué lleva), se cierra y se sella con dos cinchos.
 * Se puede reabrir para rearmarla mientras el pedido no haya salido.
 */
export const ESTADOS_CAJA = ["armada", "cerrada", "sellada"] as const;
export type EstadoCaja = (typeof ESTADOS_CAJA)[number];

/**
 * Camino del pedido surtido hasta la tienda. La pre-carga se hace el día
 * anterior y deja el folio en la unidad de una salida del rol sin amarrar al
 * chofer: el chofer se confirma hasta que la salida pasa a "en ruta".
 */
export const ETAPAS_CARGA = ["sin_cargar", "precargado", "cargado", "en_ruta"] as const;
export type EtapaCarga = (typeof ETAPAS_CARGA)[number];

export const ESTADO_CAJA_LABEL: Record<EstadoCaja, string> = {
  armada: "Armada",
  cerrada: "Caja cerrada",
  sellada: "Sellada",
};

export const ETAPA_CARGA_LABEL: Record<EtapaCarga, string> = {
  sin_cargar: "Por cargar",
  precargado: "Pre-cargado",
  cargado: "Vehículo cargado",
  en_ruta: "En ruta",
};

export const TIPO_EVENTO_LABEL: Record<string, string> = {
  capturado: "Capturó el pedido",
  nivelado: "Nivelado",
  surtidor: "Surtidor asignado",
  surtido: "Surtido completo",
  caja_armada: "Caja armada",
  caja_editada: "Caja rearmada",
  caja_cerrada: "Caja cerrada",
  caja_sellada: "Caja sellada",
  caja_reabierta: "Caja reabierta",
  caja_quitada: "Caja quitada",
  precargado: "Pre-carga",
  cambio_salida: "Cambio de salida",
  cargado: "Vehículo cargado",
  carga_deshecha: "Se bajó de la unidad",
  en_ruta: "Salió a ruta",
  recibido: "Recibido en tienda",
};

export type EventoPedido = { tipo: string; en: Date; porId: string | null; porNombre: string; detalle: string };

export function evento(usuario: { userId?: string | null; nombre?: string | null } | null, tipo: string, detalle = ""): EventoPedido {
  return { tipo, en: new Date(), porId: usuario?.userId ?? null, porNombre: usuario?.nombre ?? "", detalle: detalle.slice(0, 500) };
}

type CajaMinima = { numero: string; estado?: string | null };
type PedidoMinimo = { estado: string; cajas?: CajaMinima[] | null; carga?: { etapa?: string | null } | null };

export function etapaDe(pedido: { carga?: { etapa?: string | null } | null }): EtapaCarga {
  const etapa = pedido.carga?.etapa;
  return ETAPAS_CARGA.includes(etapa as EtapaCarga) ? (etapa as EtapaCarga) : "sin_cargar";
}

/** Las cajas viejas no traen estado: se capturaban ya selladas. */
export function estadoCaja(caja: CajaMinima): EstadoCaja {
  return ESTADOS_CAJA.includes(caja.estado as EstadoCaja) ? (caja.estado as EstadoCaja) : "sellada";
}

export function cajasSinSellar(pedido: PedidoMinimo) {
  return (pedido.cajas ?? []).filter((c) => estadoCaja(c) !== "sellada").map((c) => c.numero);
}

/**
 * Las cajas se pueden armar y rearmar desde que el pedido sale del Nivelador
 * hasta que la unidad arranca. Rearmar no saca al folio de la pre-carga: es el
 * cambio de último momento que pidió el CEDIS para no "bajar y recargar".
 */
export function puedeEditarCajas(pedido: PedidoMinimo) {
  return (pedido.estado === "nivelado" || pedido.estado === "surtido") && etapaDe(pedido) !== "en_ruta";
}

/** Por qué un folio todavía no se puede pre-cargar; vacío si ya se puede. */
export function impedimentosPrecarga(pedido: PedidoMinimo) {
  const motivos: string[] = [];
  if (pedido.estado !== "surtido") motivos.push("El pedido todavía no está surtido completo");
  const abiertas = cajasSinSellar(pedido);
  if (abiertas.length) motivos.push(`Falta sellar: caja ${abiertas.join(", ")}`);
  return motivos;
}

/** Por qué una salida todavía no puede arrancar con este folio; vacío si ya puede. */
export function impedimentosSalida(pedido: PedidoMinimo & { folio: string }) {
  const abiertas = cajasSinSellar(pedido);
  return abiertas.length ? [`${pedido.folio}: falta sellar caja ${abiertas.join(", ")}`] : [];
}
