import RolEntrega from "@/models/RolEntrega";
import Ruta from "@/models/Ruta";
import Vehiculo from "@/models/Vehiculo";
import Pedido from "@/models/Pedido";
import Sucursal from "@/models/Sucursal";
import Empleado from "@/models/Empleado";
import { obtenerConfiguracionOperacion } from "@/lib/operacion";
import { listarChoferes } from "@/lib/operacionApi";
import { asignarPedidos, conflictosDelRol, sugerirRol, type RutaPlan } from "@/lib/rolEntregas";
import { sumarDias } from "@/lib/zonasHorarias";

// Lectura y escritura del rol de entregas de un día. Lo comparten la pantalla
// de rutas (que lo edita) y la pantalla del área operativa (que solo lo lee).

/** Pedidos que ya salieron del Nivelador y todavía no confirma la tienda. */
const PENDIENTES_DE_ENTREGA = { estado: { $in: ["nivelado", "surtido"] } };

export type SalidaVista = {
  _id: string;
  rutaId: string | null;
  nombre: string;
  tipo: string;
  horaSalida: string;
  duracionMin: number;
  requiereRefrigerado: boolean;
  vehiculoId: string | null;
  vehiculoNombre: string;
  vehiculoRefrigerado: boolean;
  choferId: string | null;
  choferNombre: string;
  estado: string;
  motivoSugerencia: string;
  ajustadaManualmente: boolean;
  notas: string;
  paradas: { tipo: string; sucursalId: string | null; descripcion: string; nombre: string }[];
  pedidos: { _id: string; folio: string; sucursalNombre: string; vuelta: number; estado: string }[];
};

export type RolVista = {
  fecha: string;
  existe: boolean;
  actualizadoEn: Date | null;
  actualizadoPorNombre: string;
  salidas: SalidaVista[];
  pedidosSinSalida: { _id: string; folio: string; sucursalNombre: string; vuelta: number; estado: string }[];
  conflictos: string[];
};

const id = (v: unknown) => (v ? String(v) : null);

type ParadaDoc = { tipo: string; sucursalId?: unknown; descripcion?: string | null };
type SalidaDoc = {
  _id: unknown;
  rutaId?: unknown;
  nombre: string;
  tipo: string;
  horaSalida: string;
  duracionMin?: number | null;
  requiereRefrigerado?: boolean | null;
  vehiculoId?: unknown;
  choferId?: unknown;
  paradas?: ParadaDoc[];
  pedidoIds?: unknown[];
  estado?: string | null;
  motivoSugerencia?: string | null;
  ajustadaManualmente?: boolean | null;
  notas?: string | null;
};
type RolDoc = { salidas?: SalidaDoc[]; updatedAt?: Date; actualizadoPorNombre?: string | null };

export async function cargarRol(fecha: string): Promise<RolVista> {
  const rol = (await RolEntrega.findOne({ fecha }).lean()) as RolDoc | null;
  const salidas = rol?.salidas ?? [];
  const pedidoIds = salidas.flatMap((s) => (s.pedidoIds ?? []).map(String));

  const [vehiculos, choferes, sucursales, pedidosAsignados, pendientes] = await Promise.all([
    Vehiculo.find().select("nombre refrigerado").lean(),
    Empleado.find().select("nombre").lean(),
    Sucursal.find().select("nombre").lean(),
    Pedido.find({ _id: { $in: pedidoIds } }).select("folio sucursalId vuelta estado").lean(),
    Pedido.find(PENDIENTES_DE_ENTREGA).select("folio sucursalId vuelta estado").sort({ fecha: 1 }).lean(),
  ]);
  const vehiculo = new Map(vehiculos.map((v) => [String(v._id), v]));
  const chofer = new Map(choferes.map((c) => [String(c._id), c.nombre]));
  const sucursal = new Map(sucursales.map((s) => [String(s._id), s.nombre]));
  const pedidoVista = (p: { _id: unknown; folio: string; sucursalId: unknown; vuelta?: number | null; estado: string }) => ({
    _id: String(p._id),
    folio: p.folio,
    sucursalNombre: sucursal.get(String(p.sucursalId)) ?? "Sucursal",
    vuelta: p.vuelta ?? 1,
    estado: p.estado,
  });
  const pedidos = new Map(pedidosAsignados.map((p) => [String(p._id), pedidoVista(p)]));
  const asignados = new Set(pedidoIds);

  const vista = salidas.map((s) => {
    const v = s.vehiculoId ? vehiculo.get(String(s.vehiculoId)) : null;
    return {
      _id: String(s._id),
      rutaId: id(s.rutaId),
      nombre: s.nombre,
      tipo: s.tipo,
      horaSalida: s.horaSalida,
      duracionMin: s.duracionMin ?? 0,
      requiereRefrigerado: !!s.requiereRefrigerado,
      vehiculoId: id(s.vehiculoId),
      vehiculoNombre: v?.nombre ?? "",
      vehiculoRefrigerado: !!v?.refrigerado,
      choferId: id(s.choferId),
      choferNombre: s.choferId ? (chofer.get(String(s.choferId)) ?? "") : "",
      estado: s.estado ?? "programada",
      motivoSugerencia: s.motivoSugerencia ?? "",
      ajustadaManualmente: !!s.ajustadaManualmente,
      notas: s.notas ?? "",
      paradas: (s.paradas ?? []).map((p) => ({
        tipo: p.tipo,
        sucursalId: id(p.sucursalId),
        descripcion: p.descripcion ?? "",
        nombre: p.tipo === "sucursal" ? (sucursal.get(String(p.sucursalId)) ?? "Tienda") : (p.descripcion ?? ""),
      })),
      pedidos: (s.pedidoIds ?? []).map((pid) => pedidos.get(String(pid))).filter((p): p is NonNullable<typeof p> => !!p),
    };
  });

  return {
    fecha,
    existe: !!rol,
    actualizadoEn: rol?.updatedAt ?? null,
    actualizadoPorNombre: rol?.actualizadoPorNombre ?? "",
    salidas: vista,
    pedidosSinSalida: pendientes.filter((p) => !asignados.has(String(p._id))).map(pedidoVista),
    conflictos: conflictosDelRol(vista),
  };
}

/** Pone al chofer de cada salida como repartidor de sus pedidos (lo que ya mostraba Pedidos). */
async function sincronizarRepartidores(salidas: { choferId?: unknown; pedidoIds?: unknown[] }[]) {
  await Promise.all(
    salidas
      .filter((s) => s.choferId && s.pedidoIds?.length)
      .map((s) => Pedido.updateMany({ _id: { $in: s.pedidoIds }, estado: { $ne: "recibido" } }, { $set: { repartidorId: s.choferId } }))
  );
}

/**
 * Propone el rol completo del día (unidades, choferes y folios) y lo guarda.
 * Con `soloPedidos`, respeta las salidas ya capturadas y solo acomoda los
 * pedidos que todavía no van en ninguna (los complementos de segunda vuelta
 * que se armaron después de publicar el rol).
 */
export async function sugerirRolDelDia(fecha: string, usuario: { userId: string; nombre?: string }, { soloPedidos = false } = {}) {
  const pendientes = await Pedido.find(PENDIENTES_DE_ENTREGA).select("sucursalId vuelta").sort({ fecha: 1 }).lean();
  const existente = await RolEntrega.findOne({ fecha });

  let salidas;
  if (soloPedidos && existente) {
    salidas = existente.salidas.map((s: { toObject: () => Record<string, unknown> }) => s.toObject());
  } else {
    const [config, rutas, vehiculos, choferes, recientes] = await Promise.all([
      obtenerConfiguracionOperacion(),
      Ruta.find({ activo: true }).lean(),
      Vehiculo.find({ activo: true }).lean(),
      listarChoferes(),
      RolEntrega.find({ fecha: { $gte: sumarDias(fecha, -14), $lt: fecha } }).select("salidas.choferId").lean(),
    ]);
    const salidasRecientes = new Map<string, number>();
    for (const r of recientes) for (const s of r.salidas) if (s.choferId) salidasRecientes.set(String(s.choferId), (salidasRecientes.get(String(s.choferId)) ?? 0) + 1);

    const plan: RutaPlan[] = rutas.map((r) => ({
      _id: String(r._id),
      nombre: r.nombre,
      tipo: r.tipo,
      horaSalida: r.horaSalida,
      duracionMin: r.duracionMin,
      diasSemana: r.diasSemana,
      requiereRefrigerado: r.requiereRefrigerado,
      vehiculoPreferidoId: id(r.vehiculoPreferidoId),
      choferResponsableId: id(r.choferResponsableId),
      choferSustitutoId: id(r.choferSustitutoId),
      paradas: ((r.paradas ?? []) as ParadaDoc[]).map((p) => ({ tipo: p.tipo, sucursalId: id(p.sucursalId), descripcion: p.descripcion ?? "" })),
      activo: r.activo,
    }));
    salidas = sugerirRol({
      rutas: plan,
      vehiculos: vehiculos.map((v) => ({ _id: String(v._id), nombre: v.nombre, refrigerado: !!v.refrigerado, activo: v.activo })),
      choferes: choferes.map((c) => ({ _id: String(c._id), nombre: c.nombre, activo: c.activo })),
      fecha,
      duracionDefaultMin: config.duracionRutaMin ?? 150,
      salidasRecientes,
    }).map((s) => ({ ...s, pedidoIds: [] as string[], estado: "programada", ajustadaManualmente: false, notas: "" }));
  }

  const yaAsignados = new Set(salidas.flatMap((s: { pedidoIds?: unknown[] }) => (s.pedidoIds ?? []).map(String)));
  const porAsignar = pendientes.filter((p) => !yaAsignados.has(String(p._id)));
  for (const { pedidoId, indice } of asignarPedidos(
    salidas.map((s: { tipo: string; paradas: { tipo: string; sucursalId?: unknown }[] }) => ({ tipo: s.tipo, paradas: s.paradas.map((p) => ({ tipo: p.tipo, sucursalId: id(p.sucursalId) })) })) as never,
    porAsignar.map((p) => ({ _id: String(p._id), sucursalId: String(p.sucursalId), vuelta: p.vuelta ?? 1 }))
  )) {
    if (indice >= 0) salidas[indice].pedidoIds = [...(salidas[indice].pedidoIds ?? []), pedidoId];
  }

  await RolEntrega.findOneAndUpdate(
    { fecha },
    { $set: { salidas, generadoEn: new Date(), actualizadoPorId: usuario.userId, actualizadoPorNombre: usuario.nombre ?? "" } },
    { upsert: true }
  );
  await sincronizarRepartidores(salidas);
  return cargarRol(fecha);
}

export type SalidaEditada = {
  _id?: string;
  rutaId?: string | null;
  nombre: string;
  tipo: string;
  horaSalida: string;
  duracionMin: number;
  requiereRefrigerado?: boolean;
  vehiculoId: string | null;
  choferId: string | null;
  paradas: { tipo: string; sucursalId: string | null; descripcion: string }[];
  pedidoIds: string[];
  estado: string;
  motivoSugerencia?: string;
  ajustadaManualmente?: boolean;
  notas?: string;
};

/** Guarda el rol tal como lo dejó el coordinador (ajuste manual). */
export async function guardarRolDelDia(fecha: string, salidas: SalidaEditada[], usuario: { userId: string; nombre?: string }) {
  await RolEntrega.findOneAndUpdate(
    { fecha },
    { $set: { salidas, actualizadoPorId: usuario.userId, actualizadoPorNombre: usuario.nombre ?? "" } },
    { upsert: true, runValidators: true }
  );
  await sincronizarRepartidores(salidas);
  return cargarRol(fecha);
}
