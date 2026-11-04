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

/** Dónde se lee el QR: al subir a la unidad, al acomodar por chofer y al llegar a tienda. */
export const PUNTOS_ESCANEO = ["carga", "acomodo", "recepcion"] as const;
export type PuntoEscaneo = (typeof PUNTOS_ESCANEO)[number];

export const PUNTO_ESCANEO_LABEL: Record<PuntoEscaneo, string> = {
  carga: "Carga en CEDIS",
  acomodo: "Acomodo por chofer",
  recepcion: "Recepción en tienda",
};

/** Lo que puede salir mal con una caja o un folio en el camino. */
export const TIPOS_INCIDENCIA = ["sucursal_incorrecta", "caja_faltante", "caja_danada", "folio_devuelto", "merma", "otro"] as const;
export type TipoIncidencia = (typeof TIPOS_INCIDENCIA)[number];

export const TIPO_INCIDENCIA_LABEL: Record<TipoIncidencia, string> = {
  sucursal_incorrecta: "Llegó a otra sucursal",
  caja_faltante: "Caja faltante",
  caja_danada: "Caja dañada o abierta",
  folio_devuelto: "Folio devuelto",
  merma: "Merma",
  otro: "Otro",
};

/** Renglones de la bitácora de rutas: lo que pasa con una salida después de la carga. */
export const TIPOS_EVENTO_RUTA = ["salida", "llegada", "parada_extra", "folio_devuelto", "merma", "incidencia", "escaneo", "regreso", "nota"] as const;
export type TipoEventoRuta = (typeof TIPOS_EVENTO_RUTA)[number];

export const TIPO_EVENTO_RUTA_LABEL: Record<TipoEventoRuta, string> = {
  salida: "Salió",
  llegada: "Llegó a parada",
  parada_extra: "Parada extraordinaria",
  folio_devuelto: "Folio devuelto",
  merma: "Merma o irregularidad",
  incidencia: "Incidencia",
  escaneo: "Escaneo",
  regreso: "Regresó al CEDIS",
  nota: "Nota",
};

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
  escaneo: "Escaneo",
  incidencia: "Incidencia",
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
