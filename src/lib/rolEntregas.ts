// Sugerencia del rol de entregas del día: qué unidad y qué chofer sale en cada
// ruta y qué folios lleva. Es una propuesta: el coordinador la ajusta a mano y
// el ajuste queda marcado, que es como se decidió operar (asignación sugerida
// con ajuste manual, porque la rotación de choferes depende de quién llegó).
//
// Reglas, en orden:
//  1. Unidad: la preferida de la ruta si está libre; si la ruta lleva
//     perecedero, solo una refrigerada; si no, se prefieren las secas para no
//     ocupar una refrigerada sin necesidad.
//  2. Chofer: el responsable de la ruta, luego su sustituto y, si ninguno está
//     libre, el que menos salidas lleva (hoy y en las últimas dos semanas).
//  3. Una unidad o un chofer no pueden estar en dos salidas que se empalman.

import { DIAS_SEMANA } from "@/lib/dias";

type Id = string;

export type RutaPlan = {
  _id: Id;
  nombre: string;
  tipo: "primera_vuelta" | "segunda_vuelta" | "especial";
  horaSalida: string;
  duracionMin?: number;
  diasSemana?: string[];
  requiereRefrigerado?: boolean;
  vehiculoPreferidoId?: Id | null;
  choferResponsableId?: Id | null;
  choferSustitutoId?: Id | null;
  paradas: { tipo: string; sucursalId?: Id | null; descripcion?: string }[];
  activo?: boolean;
};

export type VehiculoPlan = { _id: Id; nombre: string; refrigerado: boolean; activo?: boolean };
export type ChoferPlan = { _id: Id; nombre: string; activo?: boolean };

export type SalidaSugerida = {
  rutaId: Id;
  nombre: string;
  tipo: RutaPlan["tipo"];
  horaSalida: string;
  duracionMin: number;
  requiereRefrigerado: boolean;
  vehiculoId: Id | null;
  choferId: Id | null;
  paradas: RutaPlan["paradas"];
  motivoSugerencia: string;
};

export type PedidoPlan = { _id: Id; sucursalId: Id; vuelta: number };

export function minutosDe(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Día de la semana ("lunes"...) de una fecha YYYY-MM-DD, sin depender de la zona del servidor. */
export function diaSemanaDe(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return DIAS_SEMANA[(dow + 6) % 7];
}

export function rutasDelDia(rutas: RutaPlan[], ymd: string) {
  const dia = diaSemanaDe(ymd);
  return rutas
    .filter((r) => r.activo !== false && (!r.diasSemana?.length || r.diasSemana.includes(dia)))
    .sort((a, b) => minutosDe(a.horaSalida) - minutosDe(b.horaSalida));
}

type Ventana = { inicio: number; fin: number };
const seEmpalma = (a: Ventana, b: Ventana) => a.inicio < b.fin && b.inicio < a.fin;

export function sugerirRol({
  rutas,
  vehiculos,
  choferes,
  fecha,
  duracionDefaultMin,
  salidasRecientes = new Map(),
}: {
  rutas: RutaPlan[];
  vehiculos: VehiculoPlan[];
  choferes: ChoferPlan[];
  fecha: string;
  duracionDefaultMin: number;
  /** choferId → salidas en las últimas dos semanas, para rotar parejo. */
  salidasRecientes?: Map<Id, number>;
}): SalidaSugerida[] {
  const unidades = vehiculos.filter((v) => v.activo !== false);
  const activos = choferes.filter((c) => c.activo !== false);
  const idsActivos = new Set(activos.map((c) => c._id));
  const ocupacionVehiculo = new Map<Id, Ventana[]>();
  const ocupacionChofer = new Map<Id, Ventana[]>();
  const libre = (mapa: Map<Id, Ventana[]>, id: Id, v: Ventana) => !(mapa.get(id) ?? []).some((o) => seEmpalma(o, v));
  const ocupar = (mapa: Map<Id, Ventana[]>, id: Id, v: Ventana) => mapa.set(id, [...(mapa.get(id) ?? []), v]);
  const cargaHoy = (id: Id) => ocupacionChofer.get(id)?.length ?? 0;
  const nombreChofer = (id: Id) => activos.find((c) => c._id === id)?.nombre ?? "";

  return rutasDelDia(rutas, fecha).map((ruta) => {
    const duracion = ruta.duracionMin || duracionDefaultMin;
    const ventana = { inicio: minutosDe(ruta.horaSalida), fin: minutosDe(ruta.horaSalida) + duracion };
    const motivos: string[] = [];

    // ---- Unidad ----
    const aptas = unidades.filter((v) => (!ruta.requiereRefrigerado || v.refrigerado) && libre(ocupacionVehiculo, v._id, ventana));
    let vehiculo = aptas.find((v) => v._id === ruta.vehiculoPreferidoId) ?? null;
    if (vehiculo) motivos.push("unidad preferida de la ruta");
    else {
      vehiculo =
        [...aptas].sort((a, b) => {
          if (!ruta.requiereRefrigerado && a.refrigerado !== b.refrigerado) return a.refrigerado ? 1 : -1;
          return (ocupacionVehiculo.get(a._id)?.length ?? 0) - (ocupacionVehiculo.get(b._id)?.length ?? 0);
        })[0] ?? null;
      if (vehiculo) motivos.push(ruta.vehiculoPreferidoId ? "la unidad preferida está ocupada" : "unidad disponible");
      else motivos.push(ruta.requiereRefrigerado ? "no hay unidad refrigerada libre" : "no hay unidad libre");
    }
    if (vehiculo) ocupar(ocupacionVehiculo, vehiculo._id, ventana);

    // ---- Chofer ----
    let choferId: Id | null = null;
    const candidato = (id: Id | null | undefined) => !!id && idsActivos.has(id) && libre(ocupacionChofer, id, ventana);
    if (candidato(ruta.choferResponsableId)) {
      choferId = ruta.choferResponsableId!;
      motivos.push("chofer responsable");
    } else if (candidato(ruta.choferSustitutoId)) {
      choferId = ruta.choferSustitutoId!;
      motivos.push(ruta.choferResponsableId ? "el responsable no está disponible; entra su sustituto" : "chofer sustituto");
    } else {
      const libres = activos
        .filter((c) => libre(ocupacionChofer, c._id, ventana))
        .sort((a, b) => cargaHoy(a._id) - cargaHoy(b._id) || (salidasRecientes.get(a._id) ?? 0) - (salidasRecientes.get(b._id) ?? 0) || a.nombre.localeCompare(b.nombre));
      choferId = libres[0]?._id ?? null;
      motivos.push(choferId ? `rotación: ${nombreChofer(choferId)} lleva menos salidas` : "no hay chofer libre a esa hora");
    }
    if (choferId) ocupar(ocupacionChofer, choferId, ventana);

    return {
      rutaId: ruta._id,
      nombre: ruta.nombre,
      tipo: ruta.tipo,
      horaSalida: ruta.horaSalida,
      duracionMin: duracion,
      requiereRefrigerado: !!ruta.requiereRefrigerado,
      vehiculoId: vehiculo?._id ?? null,
      choferId,
      paradas: ruta.paradas,
      motivoSugerencia: motivos.join(" · "),
    };
  });
}

/**
 * A qué salida va cada pedido pendiente de entrega: los complementos (vuelta 2)
 * a la primera segunda vuelta que pase por su tienda; los originales a la
 * primera vuelta. Si no hay una del tipo correcto, a cualquiera que pase por
 * la tienda. Devuelve el índice de la salida o -1.
 */
export function asignarPedidos(salidas: Pick<SalidaSugerida, "tipo" | "paradas">[], pedidos: PedidoPlan[]) {
  const pasaPor = (s: (typeof salidas)[number], sucursalId: Id) =>
    s.paradas.some((p) => p.tipo === "sucursal" && String(p.sucursalId) === sucursalId);
  return pedidos.map((pedido) => {
    const tipo = pedido.vuelta === 2 ? "segunda_vuelta" : "primera_vuelta";
    let indice = salidas.findIndex((s) => s.tipo === tipo && pasaPor(s, pedido.sucursalId));
    if (indice < 0) indice = salidas.findIndex((s) => pasaPor(s, pedido.sucursalId));
    return { pedidoId: pedido._id, indice };
  });
}

/** Choferes o unidades que quedaron en dos salidas que se empalman (tras un ajuste manual). */
export function conflictosDelRol(salidas: { horaSalida: string; duracionMin: number; vehiculoId?: Id | null; choferId?: Id | null; nombre: string }[]) {
  const conflictos: string[] = [];
  for (let i = 0; i < salidas.length; i++) {
    for (let j = i + 1; j < salidas.length; j++) {
      const a = salidas[i];
      const b = salidas[j];
      const va = { inicio: minutosDe(a.horaSalida), fin: minutosDe(a.horaSalida) + a.duracionMin };
      const vb = { inicio: minutosDe(b.horaSalida), fin: minutosDe(b.horaSalida) + b.duracionMin };
      if (!seEmpalma(va, vb)) continue;
      if (a.choferId && a.choferId === b.choferId) conflictos.push(`El mismo chofer está en "${a.nombre}" y "${b.nombre}" a la misma hora`);
      if (a.vehiculoId && a.vehiculoId === b.vehiculoId) conflictos.push(`La misma unidad está en "${a.nombre}" y "${b.nombre}" a la misma hora`);
    }
  }
  return conflictos;
}
