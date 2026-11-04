import type { NextRequest } from "next/server";
import Incidencia from "@/models/Incidencia";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

export type IncidenciaVista = {
  _id: string;
  tipo: string;
  estado: string;
  folio: string;
  pedidoId: string | null;
  cajaNumero: string;
  sucursalDestino: string;
  sucursalDetecto: string;
  creadaEn: string;
  creadaPorNombre: string;
  comentarios: { en: string; porNombre: string; texto: string }[];
  resueltaEn: string | null;
  resueltaPorNombre: string;
};

/** Sesión que puede ver incidencias: el CEDIS (surte) o la tienda (recibe). */
export async function sesionIncidencias(req: NextRequest): Promise<{ session: SessionPayload; error?: undefined } | { error: Response; session?: undefined }> {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role === "matriz" && !puede(session, "pedidos.surtir")) return { error: sinPermiso("pedidos.surtir") };
  if (session.role === "sucursal" && (!session.sucursalId || !puede(session, "pedidos.recibir"))) return { error: forbidden() };
  await connectDB();
  return { session };
}

/** La tienda solo ve las incidencias de sus folios o las que detectó ella. */
export function filtroDeSesion(session: SessionPayload) {
  return session.role === "matriz" ? {} : { $or: [{ sucursalDestinoId: session.sucursalId }, { sucursalDetectoId: session.sucursalId }] };
}

type Doc = {
  _id: unknown;
  tipo: string;
  estado: string;
  folio?: string | null;
  pedidoId?: unknown;
  cajaNumero?: string | null;
  sucursalDestinoId?: unknown;
  sucursalDetectoId?: unknown;
  createdAt?: Date;
  creadaPorNombre?: string | null;
  comentarios?: { en: Date; porNombre?: string | null; texto: string }[];
  resueltaEn?: Date | null;
  resueltaPorNombre?: string | null;
};

export async function vistasIncidencias(docs: Doc[]): Promise<IncidenciaVista[]> {
  const ids = docs.flatMap((d) => [d.sucursalDestinoId, d.sucursalDetectoId]).filter(Boolean);
  const nombre = new Map((await Sucursal.find({ _id: { $in: ids } }).select("nombre").lean()).map((s) => [String(s._id), s.nombre as string]));
  return docs.map((d) => ({
    _id: String(d._id),
    tipo: d.tipo,
    estado: d.estado,
    folio: d.folio ?? "",
    pedidoId: d.pedidoId ? String(d.pedidoId) : null,
    cajaNumero: d.cajaNumero ?? "",
    sucursalDestino: d.sucursalDestinoId ? (nombre.get(String(d.sucursalDestinoId)) ?? "") : "",
    sucursalDetecto: d.sucursalDetectoId ? (nombre.get(String(d.sucursalDetectoId)) ?? "") : "",
    creadaEn: (d.createdAt ?? new Date()).toISOString(),
    creadaPorNombre: d.creadaPorNombre ?? "",
    comentarios: (d.comentarios ?? []).map((c) => ({ en: new Date(c.en).toISOString(), porNombre: c.porNombre ?? "", texto: c.texto })),
    resueltaEn: d.resueltaEn ? new Date(d.resueltaEn).toISOString() : null,
    resueltaPorNombre: d.resueltaPorNombre ?? "",
  }));
}

export async function incidenciasDePedido(pedidoId: string) {
  return vistasIncidencias((await Incidencia.find({ pedidoId }).sort({ createdAt: -1 }).lean()) as Doc[]);
}
