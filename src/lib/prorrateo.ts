import type { AsignacionSucursal } from "@/lib/nivelador";

export type CriterioProrrateo = "caja_completa" | "proporcional" | "prioridad";

export type DemandaPriorizada = {
  sucursalId: string;
  cantidad: number;
  /** 1 = se atiende primero. Las tiendas sin prioridad capturada van al final. */
  prioridad?: number;
};

export type OpcionesProrrateo = {
  criterio: CriterioProrrateo;
  /** 0 = el producto no se maneja por caja; caja_completa se comporta como proporcional. */
  piezasPorCaja?: number;
};

export const CRITERIO_LABEL: Record<CriterioProrrateo, string> = {
  caja_completa: "Cajas completas (proporcional por caja)",
  proporcional: "Proporcional a lo pedido",
  prioridad: "Por prioridad de tienda",
};

const SIN_PRIORIDAD = Number.MAX_SAFE_INTEGER;

function ordenPorPrioridad(demandas: DemandaPriorizada[]) {
  return [...demandas].sort((a, b) => {
    const pa = a.prioridad ?? SIN_PRIORIDAD;
    const pb = b.prioridad ?? SIN_PRIORIDAD;
    if (pa !== pb) return pa - pb;
    if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
    return a.sucursalId.localeCompare(b.sucursalId);
  });
}

/**
 * Residuo mayor (Hamilton), igual que el Nivelador, pero los empates de
 * residuo se los lleva la tienda con mejor prioridad en vez de la de id menor.
 */
function proporcional(existencia: number, demandas: DemandaPriorizada[]) {
  const totalDemanda = demandas.reduce((s, d) => s + d.cantidad, 0);
  const asignado = new Map<string, number>();
  if (existencia <= 0 || totalDemanda === 0) return asignado;
  if (totalDemanda <= existencia) {
    for (const d of demandas) asignado.set(d.sucursalId, d.cantidad);
    return asignado;
  }
  const cuotas = demandas.map((d) => {
    const exacta = (existencia * d.cantidad) / totalDemanda;
    return { ...d, base: Math.floor(exacta), resto: exacta - Math.floor(exacta) };
  });
  for (const c of cuotas) asignado.set(c.sucursalId, c.base);
  let restantes = existencia - cuotas.reduce((s, c) => s + c.base, 0);
  const orden = [...cuotas].sort(
    (a, b) =>
      b.resto - a.resto ||
      (a.prioridad ?? SIN_PRIORIDAD) - (b.prioridad ?? SIN_PRIORIDAD) ||
      b.cantidad - a.cantidad ||
      a.sucursalId.localeCompare(b.sucursalId)
  );
  for (let i = 0; i < orden.length && restantes > 0; i++, restantes--) {
    asignado.set(orden[i].sucursalId, (asignado.get(orden[i].sucursalId) ?? 0) + 1);
  }
  return asignado;
}

/** Llena tienda por tienda, en orden de prioridad, hasta agotar la existencia. */
function porPrioridad(existencia: number, demandas: DemandaPriorizada[], asignado = new Map<string, number>()) {
  let restante = existencia;
  for (const d of ordenPorPrioridad(demandas)) {
    if (restante <= 0) break;
    const ya = asignado.get(d.sucursalId) ?? 0;
    const falta = Math.max(0, d.cantidad - ya);
    const dar = Math.min(falta, restante);
    asignado.set(d.sucursalId, ya + dar);
    restante -= dar;
  }
  return asignado;
}

/**
 * Reparte una existencia que no alcanza entre las tiendas que pidieron el mismo
 * producto, según el criterio que el CEDIS tenga configurado.
 *
 * Si alcanza para todos, cada tienda recibe exactamente lo que pidió, sea cual
 * sea el criterio: el prorrateo solo decide cómo se reparte la escasez.
 *
 * "caja_completa" es el método que se usaba con el aguacate y ahora aplica a
 * abarrotes: primero se reparten cajas cerradas de forma proporcional (cada
 * tienda recibe como máximo las cajas completas que caben en lo que pidió) y
 * las piezas sueltas que sobran se dan por prioridad, para no abrir cajas de
 * más. Lo que no alcanzó se completa en la segunda vuelta.
 */
export function prorratear(
  existencia: number,
  demandas: DemandaPriorizada[],
  opciones: OpcionesProrrateo
): AsignacionSucursal[] {
  const totalDemanda = demandas.reduce((s, d) => s + d.cantidad, 0);
  const salida = (asignado: Map<string, number>) =>
    demandas.map((d) => ({ sucursalId: d.sucursalId, cantidadAsignada: asignado.get(d.sucursalId) ?? 0 }));

  if (existencia <= 0 || totalDemanda === 0) return salida(new Map());
  if (totalDemanda <= existencia) return salida(new Map(demandas.map((d) => [d.sucursalId, d.cantidad])));

  if (opciones.criterio === "prioridad") return salida(porPrioridad(existencia, demandas));

  const piezasPorCaja = Math.floor(opciones.piezasPorCaja ?? 0);
  if (opciones.criterio === "proporcional" || piezasPorCaja <= 1) {
    return salida(proporcional(existencia, demandas));
  }

  // Cajas completas: Hamilton sobre cajas, con la demanda de cada tienda en
  // cajas enteras (una tienda que pidió 6 piezas de una caja de 12 no se lleva
  // una caja: recibe piezas sueltas si sobran).
  const cajasDisponibles = Math.floor(existencia / piezasPorCaja);
  const cajas = proporcional(
    cajasDisponibles,
    demandas.map((d) => ({ ...d, cantidad: Math.floor(d.cantidad / piezasPorCaja) }))
  );
  const asignado = new Map([...cajas].map(([sucursalId, n]) => [sucursalId, n * piezasPorCaja]));
  const usadas = [...cajas.values()].reduce((s, n) => s + n, 0) * piezasPorCaja;

  // Lo que queda (piezas sueltas y cajas que nadie podía llevarse entera) se
  // reparte por prioridad sin pasarse de lo que pidió cada tienda.
  return salida(porPrioridad(existencia - usadas, demandas, asignado));
}
