// Rotación de perecederos: qué tan viejo es lo que hay en el CEDIS y qué tiene
// que salir primero.
//
// No hay lotes físicos en el sistema, así que la antigüedad se estima con PEPS
// (primeras entradas, primeras salidas): si hay 30 kg y las últimas entradas
// fueron 20 kg el lunes y 15 kg el sábado, se asume que quedan los 20 del lunes
// y 10 del sábado. Es la misma regla con la que se surte en piso, por lo que la
// estimación es buena mientras se respete el "sale primero lo maduro".

const MS_DIA = 24 * 60 * 60 * 1000;

export type Entrada = { fecha: Date; cantidad: number };

export type EstadoRotacion = "fresco" | "madurando" | "urgente" | "vencido" | "sin_fecha";

export type Tramo = {
  /** null = la existencia es más vieja que el historial de entradas consultado. */
  fecha: Date | null;
  cantidad: number;
  diasEnAlmacen: number | null;
  estado: EstadoRotacion;
};

export type EvaluacionPerecedero = {
  estado: EstadoRotacion;
  tramos: Tramo[];
  /** Lo que tiene que salir hoy o mañana (urgente + vencido + sin fecha). */
  cantidadEnRiesgo: number;
  diasMasViejo: number | null;
  /** Salida diaria promedio de los últimos días (pedidos surtidos y ventas de mostrador). */
  salidaDiaria: number;
  /** Días que dura la existencia al ritmo de salida actual; null si no hay salidas. */
  diasCobertura: number | null;
  /** Lo que no alcanza a salir antes de pasarse, al ritmo actual. */
  excedente: number;
  recomendacion: string;
};

export const ESTADO_ROTACION_LABEL: Record<EstadoRotacion, string> = {
  fresco: "Fresco",
  madurando: "Priorizar salida",
  urgente: "Sale hoy",
  vencido: "Revisar merma",
  sin_fecha: "Sin fecha de entrada",
};

const GRAVEDAD: Record<EstadoRotacion, number> = { fresco: 0, madurando: 1, sin_fecha: 2, urgente: 3, vencido: 4 };

export function estadoPorEdad(dias: number, vidaUtilDias: number): EstadoRotacion {
  const avance = dias / vidaUtilDias;
  if (avance >= 1) return "vencido";
  if (avance >= 0.8) return "urgente";
  if (avance >= 0.5) return "madurando";
  return "fresco";
}

/** Reparte la existencia actual entre las entradas más recientes (PEPS). */
export function tramosPeps(existencia: number, entradas: Entrada[], vidaUtilDias: number, ahora = new Date()): Tramo[] {
  const tramos: Tramo[] = [];
  let pendiente = Math.max(0, existencia);
  const recientes = [...entradas].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  for (const entrada of recientes) {
    if (pendiente <= 0) break;
    const cantidad = Math.min(entrada.cantidad, pendiente);
    if (cantidad <= 0) continue;
    const dias = Math.max(0, Math.floor((ahora.getTime() - entrada.fecha.getTime()) / MS_DIA));
    tramos.push({ fecha: entrada.fecha, cantidad, diasEnAlmacen: dias, estado: estadoPorEdad(dias, vidaUtilDias) });
    pendiente -= cantidad;
  }
  if (pendiente > 0) tramos.push({ fecha: null, cantidad: pendiente, diasEnAlmacen: null, estado: "sin_fecha" });
  return tramos;
}

export function evaluarPerecedero({
  existencia,
  entradas,
  vidaUtilDias,
  salidaDiaria,
  ahora = new Date(),
}: {
  existencia: number;
  entradas: Entrada[];
  vidaUtilDias: number;
  salidaDiaria: number;
  ahora?: Date;
}): EvaluacionPerecedero {
  const tramos = tramosPeps(existencia, entradas, vidaUtilDias, ahora);
  const estado = tramos.reduce<EstadoRotacion>((peor, t) => (GRAVEDAD[t.estado] > GRAVEDAD[peor] ? t.estado : peor), "fresco");
  const cantidadEnRiesgo = tramos
    .filter((t) => t.estado === "urgente" || t.estado === "vencido" || t.estado === "sin_fecha")
    .reduce((s, t) => s + t.cantidad, 0);
  const conFecha = tramos.filter((t) => t.diasEnAlmacen !== null);
  const diasMasViejo = conFecha.length ? Math.max(...conFecha.map((t) => t.diasEnAlmacen!)) : null;
  const diasCobertura = salidaDiaria > 0 ? existencia / salidaDiaria : null;

  // Cada tramo tiene hasta su caducidad para salir; al ritmo actual, lo que no
  // cabe en ese tiempo (en orden PEPS) es lo que se va a perder.
  let excedente = 0;
  if (existencia > 0) {
    if (salidaDiaria <= 0) excedente = existencia;
    else {
      let diaAcumulado = 0;
      for (const t of [...tramos].reverse()) {
        const restante = t.diasEnAlmacen === null ? 0 : Math.max(0, vidaUtilDias - t.diasEnAlmacen);
        const capacidad = Math.max(0, (restante - diaAcumulado) * salidaDiaria);
        const sale = Math.min(t.cantidad, capacidad);
        excedente += t.cantidad - sale;
        diaAcumulado += sale / salidaDiaria;
      }
    }
  }
  excedente = Math.round(excedente * 100) / 100;

  return {
    estado,
    tramos,
    cantidadEnRiesgo,
    diasMasViejo,
    salidaDiaria,
    diasCobertura: diasCobertura === null ? null : Math.round(diasCobertura * 10) / 10,
    excedente,
    recomendacion: recomendacion(estado, excedente, cantidadEnRiesgo),
  };
}

function recomendacion(estado: EstadoRotacion, excedente: number, enRiesgo: number) {
  if (estado === "vencido") return "Revisar en piso: hay producto que ya pasó su vida útil estimada. Separar merma.";
  if (estado === "urgente") return `Surtir primero lo maduro (${enRiesgo}) en la siguiente vuelta.`;
  if (estado === "sin_fecha") return "Hay existencia más vieja que el historial; revisar en piso y surtir primero.";
  if (excedente > 0) return `Llegó más de lo que se vende: ${excedente} no alcanzan a salir. Repartir en segunda vuelta o pedir menos.`;
  if (estado === "madurando") return "Priorizar su salida en los próximos pedidos.";
  return "Sin acción.";
}

export function gravedad(estado: EstadoRotacion) {
  return GRAVEDAD[estado];
}
