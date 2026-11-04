import Pedido from "@/models/Pedido";
import RolEntrega from "@/models/RolEntrega";
import Vehiculo from "@/models/Vehiculo";
import Empleado from "@/models/Empleado";
import Sucursal from "@/models/Sucursal";
import "@/models/User"; // necesario para que populate("surtidoPorId"/"recibidoPorId") funcione
import { montoLineaPedido } from "@/lib/montoPedido";
import { estadoCaja, etapaDe, impedimentosPrecarga, type EstadoCaja, type EtapaCarga } from "@/lib/logistica";

// Tarjeta digital del folio: en una sola vista quién capturó, surtió y cargó,
// a qué tienda va, qué lleva cada caja, en qué salida, con qué chofer y a qué
// hora. Reemplaza al ticket impreso para jefes y recepciones (minuta del 28 de
// octubre).

export type Responsable = { rol: string; nombre: string; en: string | null; nota?: string };

export type TarjetaFolio = {
  _id: string;
  folio: string;
  sucursalNombre: string;
  estado: string;
  vuelta: number;
  corte: string;
  etapa: EtapaCarga;
  /** Salida de la pre-carga, para que la pantalla marque la actual. */
  fechaSalida: string | null;
  salidaId: string | null;
  verMontos: boolean;
  total: number;
  responsables: Responsable[];
  salida: {
    nombre: string;
    fecha: string;
    horaSalida: string;
    estado: string;
    vehiculo: string;
    choferProgramado: string;
    paradas: string[];
  } | null;
  cajas: { numero: string; estado: EstadoCaja; categoria: string; cinchos: string; contenido: string }[];
  items: { nombre: string; unidad: string; pedido: number; surtido: number | null; peso: number | null; recibido: number | null; precio: number | null; subtotal: number | null }[];
  historial: { tipo: string; en: string; porNombre: string; detalle: string }[];
  impedimentosPrecarga: string[];
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const nombreDe = (v: unknown) => (v && typeof v === "object" && "nombre" in v ? String((v as { nombre: unknown }).nombre ?? "") : "");

type SalidaDoc = {
  _id: unknown;
  nombre: string;
  horaSalida: string;
  estado?: string | null;
  vehiculoId?: unknown;
  choferId?: unknown;
  paradas?: { tipo: string; sucursalId?: unknown; descripcion?: string | null }[];
  pedidoIds?: unknown[];
};

/** La salida de la pre-carga o, si no hay, la del rol más reciente que lleva el folio. */
async function salidaDelFolio(pedidoId: string, carga: { fechaSalida?: string | null; salidaId?: unknown } | null | undefined) {
  if (carga?.fechaSalida) {
    const rol = await RolEntrega.findOne({ fecha: carga.fechaSalida }).lean();
    const salida = (rol?.salidas as SalidaDoc[] | undefined)?.find((s) => String(s._id) === String(carga.salidaId));
    if (rol && salida) return { fecha: rol.fecha as string, salida };
  }
  const rol = await RolEntrega.findOne({ "salidas.pedidoIds": pedidoId }).sort({ fecha: -1 }).lean();
  const salida = (rol?.salidas as SalidaDoc[] | undefined)?.find((s) => (s.pedidoIds ?? []).some((p) => String(p) === pedidoId));
  return rol && salida ? { fecha: rol.fecha as string, salida } : null;
}

export async function armarTarjetaFolio(pedidoId: string, verMontos: boolean): Promise<TarjetaFolio | null> {
  const pedido = await Pedido.findById(pedidoId)
    .populate("sucursalId", "nombre")
    .populate("repartidorId", "nombre")
    .populate("surtidorId", "nombre")
    .populate("cargadorId", "nombre")
    .populate("surtidoPorId", "nombre")
    .populate("recibidoPorId", "nombre")
    .lean();
  if (!pedido) return null;

  const enSalida = await salidaDelFolio(String(pedido._id), pedido.carga);
  let salida: TarjetaFolio["salida"] = null;
  if (enSalida) {
    const s = enSalida.salida;
    const sucursalIds = (s.paradas ?? []).filter((p) => p.tipo === "sucursal").map((p) => p.sucursalId);
    const [vehiculo, chofer, sucursales] = await Promise.all([
      s.vehiculoId ? Vehiculo.findById(s.vehiculoId).select("nombre").lean() : null,
      s.choferId ? Empleado.findById(s.choferId).select("nombre").lean() : null,
      Sucursal.find({ _id: { $in: sucursalIds } }).select("nombre").lean(),
    ]);
    const tienda = new Map(sucursales.map((t) => [String(t._id), t.nombre as string]));
    salida = {
      nombre: s.nombre,
      fecha: enSalida.fecha,
      horaSalida: s.horaSalida,
      estado: s.estado ?? "programada",
      vehiculo: nombreDe(vehiculo),
      choferProgramado: nombreDe(chofer),
      paradas: (s.paradas ?? []).map((p) => (p.tipo === "sucursal" ? (tienda.get(String(p.sucursalId)) ?? "Tienda") : (p.descripcion ?? ""))),
    };
  }

  const etapa = etapaDe(pedido);
  const chofer = nombreDe(pedido.repartidorId);
  const responsables: Responsable[] = [
    { rol: "Capturó", nombre: pedido.capturadoPorNombre || (pedido.vuelta === 2 ? "Sistema (segunda vuelta)" : ""), en: iso(pedido.createdAt) },
    { rol: "Surtidor", nombre: nombreDe(pedido.surtidorId), en: null },
    { rol: "Registró el surtido", nombre: nombreDe(pedido.surtidoPorId), en: iso(pedido.surtidoEn) },
    { rol: "Cargó", nombre: nombreDe(pedido.cargadorId), en: iso(pedido.carga?.cargadoEn) },
    etapa === "en_ruta" || chofer
      ? { rol: "Chofer", nombre: chofer, en: iso(pedido.carga?.salioEn) }
      : { rol: "Chofer", nombre: salida?.choferProgramado ?? "", en: null, nota: salida?.choferProgramado ? "Programado: se confirma al salir" : undefined },
    { rol: "Recibió en tienda", nombre: nombreDe(pedido.recibidoPorId), en: iso(pedido.recibidoEn) },
  ];

  const items = pedido.items.map((i: (typeof pedido.items)[number]) => ({
    nombre: i.nombreProducto,
    unidad: i.unidad,
    pedido: i.cantidadPedida,
    surtido: i.cantidadSurtida ?? null,
    peso: i.pesoSurtidoKg ?? null,
    recibido: i.cantidadRecibida ?? null,
    precio: verMontos ? (i.precioVenta ?? 0) : null,
    subtotal: verMontos ? montoLineaPedido(i) : null,
  }));

  return {
    _id: String(pedido._id),
    folio: pedido.folio,
    sucursalNombre: nombreDe(pedido.sucursalId) || "Sucursal",
    estado: pedido.estado,
    vuelta: pedido.vuelta ?? 1,
    corte: pedido.corte,
    etapa,
    fechaSalida: pedido.carga?.fechaSalida ?? null,
    salidaId: pedido.carga?.salidaId ? String(pedido.carga.salidaId) : null,
    verMontos,
    total: verMontos ? items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0) : 0,
    responsables,
    salida,
    cajas: (pedido.cajas ?? []).map((c: (typeof pedido.cajas)[number]) => ({
      numero: c.numero,
      estado: estadoCaja(c),
      categoria: c.categoria ?? "",
      cinchos: c.cincho1 ? `${c.cincho1} / ${c.cincho2}` : "",
      contenido: c.items.map((i: { nombreProducto: string; cantidad: number }) => `${i.nombreProducto} (${i.cantidad})`).join(", "),
    })),
    items,
    historial: [...(pedido.historial ?? [])]
      .sort((a, b) => new Date(b.en).getTime() - new Date(a.en).getTime())
      .map((e) => ({ tipo: e.tipo, en: iso(e.en)!, porNombre: e.porNombre ?? "", detalle: e.detalle ?? "" })),
    impedimentosPrecarga: impedimentosPrecarga(pedido),
  };
}
