import { NextRequest, NextResponse } from "next/server";
import Incidencia from "@/models/Incidencia";
import Pedido from "@/models/Pedido";
import { badRequest, notFound } from "@/lib/apiAuth";
import { evento, TIPOS_INCIDENCIA, TIPO_INCIDENCIA_LABEL, type TipoIncidencia } from "@/lib/logistica";
import { filtroDeSesion, sesionIncidencias, vistasIncidencias } from "@/lib/incidencias";
import { registrarEventoRuta } from "@/lib/trazabilidad";
import { salidaDelFolio } from "@/lib/tarjetaFolio";

export async function GET(req: NextRequest) {
  const { session, error } = await sesionIncidencias(req);
  if (error) return error;
  const estado = req.nextUrl.searchParams.get("estado");
  const filtro: Record<string, unknown> = { ...filtroDeSesion(session) };
  if (estado === "abierta" || estado === "resuelta") filtro.estado = estado;
  const docs = await Incidencia.find(filtro).sort({ estado: 1, createdAt: -1 }).limit(300).lean();
  return NextResponse.json(await vistasIncidencias(docs));
}

/** Abre una incidencia a mano (caja faltante, dañada, merma…) sobre un folio. */
export async function POST(req: NextRequest) {
  const { session, error } = await sesionIncidencias(req);
  if (error) return error;
  const body = await req.json().catch(() => null);
  const tipo = body?.tipo as TipoIncidencia;
  if (!TIPOS_INCIDENCIA.includes(tipo)) return badRequest("Tipo de incidencia inválido");
  const comentario = String(body?.comentario ?? "").trim().slice(0, 1000);
  if (!comentario) return badRequest("Describe qué pasó");
  const folio = String(body?.folio ?? "").trim().toUpperCase();
  if (!folio) return badRequest("Captura el folio");

  const pedido = await Pedido.findOne({ folio });
  if (!pedido) return notFound(`No existe el folio ${folio}`);
  if (session.role === "sucursal" && String(pedido.sucursalId) !== session.sucursalId) return badRequest("Ese folio no es de tu sucursal. Si te llegó por error, escanea su QR.");

  const cajaNumero = String(body?.cajaNumero ?? "").trim().slice(0, 20);
  const enSalida = await salidaDelFolio(String(pedido._id), pedido.carga);
  const incidencia = await Incidencia.create({
    tipo,
    pedidoId: pedido._id,
    folio: pedido.folio,
    cajaNumero,
    sucursalDestinoId: pedido.sucursalId,
    sucursalDetectoId: session.role === "sucursal" ? session.sucursalId : null,
    fechaRuta: enSalida?.fecha ?? null,
    salidaId: enSalida?.salida._id ?? null,
    creadaPorNombre: session.nombre ?? "",
    comentarios: [{ porNombre: session.nombre ?? "", sucursalId: session.sucursalId ?? null, texto: comentario }],
  });
  const detalle = `${TIPO_INCIDENCIA_LABEL[tipo]}${cajaNumero ? ` · caja ${cajaNumero}` : ""}: ${comentario}`;
  pedido.historial.push(evento(session, "incidencia", detalle));
  await pedido.save();
  if (enSalida) {
    await registrarEventoRuta({
      fecha: enSalida.fecha,
      salidaId: enSalida.salida._id,
      salidaNombre: enSalida.salida.nombre,
      tipo: tipo === "folio_devuelto" ? "folio_devuelto" : tipo === "merma" ? "merma" : "incidencia",
      detalle: `${pedido.folio} · ${detalle}`,
      folio: pedido.folio,
      pedidoId: pedido._id,
      sucursalId: session.sucursalId ?? null,
      porNombre: session.nombre ?? "",
    });
  }
  return NextResponse.json((await vistasIncidencias([incidencia.toObject()]))[0], { status: 201 });
}
