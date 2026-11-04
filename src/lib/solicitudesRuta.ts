import SolicitudRuta from "@/models/SolicitudRuta";
import Sucursal from "@/models/Sucursal";
import Pedido from "@/models/Pedido";
import { cargarRol, type SalidaVista } from "@/lib/rolDelDia";
import { sendMessage } from "@/lib/greenApi";
import { etapaDe } from "@/lib/logistica";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import type { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// Solicitudes de ruta de las tiendas (minuta del 28 de octubre, portal de
// Progreso): sugerencia de salida, vista para ambas partes y aviso a la tienda.

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export type OpcionSalida = { _id: string; nombre: string; horaSalida: string; choferNombre: string; vehiculoNombre: string; refrigerada: boolean; apta: boolean; motivo: string };

/**
 * Salidas programadas del día en las que cabe la entrega. Apta = unidad
 * refrigerada si hace falta frío y que salga antes de que cierre la ventana.
 * La sugerida es la apta con chofer que sale más cerca del inicio de la ventana.
 */
export function opcionesParaSolicitud(salidas: Pick<SalidaVista, "_id" | "nombre" | "horaSalida" | "estado" | "choferNombre" | "vehiculoNombre" | "vehiculoRefrigerado">[], s: { horaDesde: string; horaHasta: string; frio: string }) {
  const opciones: OpcionSalida[] = salidas
    .filter((x) => x.estado === "programada")
    .map((x) => {
      const faltaFrio = s.frio !== "ninguno" && !x.vehiculoRefrigerado;
      const tarde = minutos(x.horaSalida) > minutos(s.horaHasta);
      return {
        _id: x._id,
        nombre: x.nombre,
        horaSalida: x.horaSalida,
        choferNombre: x.choferNombre,
        vehiculoNombre: x.vehiculoNombre,
        refrigerada: x.vehiculoRefrigerado,
        apta: !faltaFrio && !tarde,
        motivo: faltaFrio ? "La unidad no es refrigerada" : tarde ? "Sale después del horario pedido" : x.choferNombre ? "" : "Sin chofer asignado todavía",
      };
    });
  const distancia = (o: OpcionSalida) => Math.abs(minutos(o.horaSalida) - minutos(s.horaDesde));
  const sugerida = opciones.filter((o) => o.apta).sort((a, b) => Number(!!b.choferNombre) - Number(!!a.choferNombre) || distancia(a) - distancia(b))[0];
  return { opciones, sugeridaId: sugerida?._id ?? null };
}

export type SolicitudVista = {
  _id: string;
  folio: string;
  sucursalId: string;
  sucursalNombre: string;
  pedido: { _id: string; folio: string; estado: string; etapa: string } | null;
  direccion: string;
  zona: string;
  fecha: string;
  horaDesde: string;
  horaHasta: string;
  frio: string;
  notas: string;
  estado: string;
  propuesta: { fecha: string; horaDesde: string; horaHasta: string; comentario: string } | null;
  confirmacion: { fecha: string; salidaNombre: string; horaSalida: string; choferNombre: string; vehiculoNombre: string } | null;
  historial: { en: string; porNombre: string; texto: string }[];
  creadaEn: string;
  /** Solo para el CEDIS en solicitudes por atender. */
  opciones?: OpcionSalida[];
  sugeridaId?: string | null;
};

type Doc = Record<string, unknown> & {
  _id: unknown;
  sucursalId: unknown;
  pedidoId?: unknown;
  historial?: { en: Date; porNombre?: string; texto: string }[];
  propuesta?: Record<string, string> | null;
  confirmacion?: Record<string, string> | null;
  createdAt?: Date;
};

export async function vistasSolicitudes(docs: Doc[], { conOpciones = false } = {}): Promise<SolicitudVista[]> {
  const [sucursales, pedidos] = await Promise.all([
    Sucursal.find({ _id: { $in: docs.map((d) => d.sucursalId) } }).select("nombre").lean(),
    Pedido.find({ _id: { $in: docs.map((d) => d.pedidoId).filter(Boolean) } }).select("folio estado carga.etapa").lean(),
  ]);
  const nombre = new Map(sucursales.map((s) => [String(s._id), s.nombre as string]));
  const pedido = new Map(pedidos.map((p) => [String(p._id), { _id: String(p._id), folio: p.folio as string, estado: p.estado as string, etapa: etapaDe(p) }]));
  const roles = new Map<string, SalidaVista[]>();
  if (conOpciones) {
    for (const f of new Set(docs.filter((d) => d.estado === "pendiente").map((d) => String(d.fecha)))) roles.set(f, (await cargarRol(f)).salidas);
  }
  return docs.map((d) => {
    const base: SolicitudVista = {
      _id: String(d._id),
      folio: String(d.folio),
      sucursalId: String(d.sucursalId),
      sucursalNombre: nombre.get(String(d.sucursalId)) ?? "Sucursal",
      pedido: d.pedidoId ? (pedido.get(String(d.pedidoId)) ?? null) : null,
      direccion: String(d.direccion ?? ""),
      zona: String(d.zona ?? ""),
      fecha: String(d.fecha),
      horaDesde: String(d.horaDesde),
      horaHasta: String(d.horaHasta),
      frio: String(d.frio ?? "ninguno"),
      notas: String(d.notas ?? ""),
      estado: String(d.estado),
      propuesta: d.propuesta ? { fecha: d.propuesta.fecha, horaDesde: d.propuesta.horaDesde, horaHasta: d.propuesta.horaHasta, comentario: d.propuesta.comentario ?? "" } : null,
      confirmacion: d.confirmacion
        ? { fecha: d.confirmacion.fecha, salidaNombre: d.confirmacion.salidaNombre, horaSalida: d.confirmacion.horaSalida, choferNombre: d.confirmacion.choferNombre ?? "", vehiculoNombre: d.confirmacion.vehiculoNombre ?? "" }
        : null,
      historial: (d.historial ?? []).map((h) => ({ en: new Date(h.en).toISOString(), porNombre: h.porNombre ?? "", texto: h.texto })),
      creadaEn: (d.createdAt ?? new Date()).toISOString(),
    };
    if (conOpciones && d.estado === "pendiente") Object.assign(base, opcionesParaSolicitud(roles.get(String(d.fecha)) ?? [], base));
    return base;
  });
}

export async function vistaSolicitud(id: unknown, opciones = { conOpciones: false }) {
  const doc = await SolicitudRuta.findById(id).lean();
  return doc ? (await vistasSolicitudes([doc as Doc], opciones))[0] : null;
}

/** Aviso a la tienda por WhatsApp; si falla no deshace nada. */
export async function avisarTienda(sucursalId: unknown, texto: string) {
  const sucursal = await Sucursal.findById(sucursalId).select("whatsapp").lean();
  const numero = (sucursal?.whatsapp as string | undefined)?.trim();
  if (!numero) return false;
  return sendMessage(numero, texto)
    .then(() => true)
    .catch(() => false);
}

/** La tienda pide (pedidos.crear); el CEDIS atiende (pedidos.surtir). */
export async function sesionSolicitudes(req: NextRequest): Promise<{ session: SessionPayload; error?: undefined } | { error: Response; session?: undefined }> {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role === "matriz" && !puede(session, "pedidos.surtir")) return { error: sinPermiso("pedidos.surtir") };
  if (session.role === "sucursal" && (!session.sucursalId || !puede(session, "pedidos.crear"))) return { error: forbidden() };
  await connectDB();
  return { session };
}

