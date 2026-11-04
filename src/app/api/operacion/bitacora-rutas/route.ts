import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import EventoRuta from "@/models/EventoRuta";
import RolEntrega from "@/models/RolEntrega";
import Pedido from "@/models/Pedido";
import Incidencia from "@/models/Incidencia";
import { badRequest } from "@/lib/apiAuth";
import { sesionOperacion, texto } from "@/lib/operacionApi";
import { hoyCedis } from "@/lib/operacion";
import { evento, TIPOS_EVENTO_RUTA, type TipoEventoRuta } from "@/lib/logistica";
import { registrarEventoRuta } from "@/lib/trazabilidad";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Lo que se captura a mano; salida, escaneos e incidencias los registra el sistema. */
const MANUALES: TipoEventoRuta[] = ["llegada", "parada_extra", "folio_devuelto", "merma", "regreso", "nota"];

/** Bitácora de un día, o de un rango para auditoría (`desde`/`hasta`, máximo 31 días). */
export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const q = req.nextUrl.searchParams;
  const desde = q.get("desde") || q.get("fecha") || (await hoyCedis());
  const hasta = q.get("hasta") || desde;
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return badRequest("Rango de fechas inválido");
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 31) return badRequest("Consulta máximo 31 días a la vez");
  const folio = q.get("folio")?.trim().toUpperCase();
  const eventos = await EventoRuta.find({ fecha: { $gte: desde, $lte: hasta }, ...(folio ? { folio } : {}) })
    .sort({ en: -1 })
    .limit(500)
    .lean();
  return NextResponse.json(eventos);
}

export async function POST(req: NextRequest) {
  const { session, error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => null);
  const fecha = String(body?.fecha ?? "");
  const tipo = body?.tipo as TipoEventoRuta;
  if (!FECHA.test(fecha)) return badRequest("Fecha inválida");
  if (!TIPOS_EVENTO_RUTA.includes(tipo) || !MANUALES.includes(tipo)) return badRequest("Tipo de evento inválido");
  const detalle = texto(body?.detalle, 500);
  if (!detalle) return badRequest("Describe lo que pasó");

  const rol = await RolEntrega.findOne({ fecha }).lean();
  const salida = mongoose.isValidObjectId(body?.salidaId) ? rol?.salidas.find((s: { _id: unknown }) => String(s._id) === String(body.salidaId)) : null;
  if (!salida) return badRequest("Elige la salida del rol");

  const folio = texto(body?.folio, 40).toUpperCase();
  const pedido = folio ? await Pedido.findOne({ folio }) : null;
  if (folio && !pedido) return badRequest(`No existe el folio ${folio}`);

  const registro = await registrarEventoRuta({
    fecha,
    salidaId: salida._id,
    salidaNombre: salida.nombre,
    tipo,
    detalle,
    folio: pedido?.folio ?? "",
    pedidoId: pedido?._id ?? null,
    porNombre: session.nombre ?? "",
  });

  // Un folio devuelto o una merma también quedan como incidencia del folio.
  if (pedido && (tipo === "folio_devuelto" || tipo === "merma")) {
    await Incidencia.create({
      tipo,
      pedidoId: pedido._id,
      folio: pedido.folio,
      sucursalDestinoId: pedido.sucursalId,
      fechaRuta: fecha,
      salidaId: salida._id,
      creadaPorNombre: session.nombre ?? "",
      comentarios: [{ porNombre: session.nombre ?? "", texto: detalle }],
    });
    pedido.historial.push(evento(session, "incidencia", `${tipo === "merma" ? "Merma" : "Folio devuelto"} en ${salida.nombre}: ${detalle}`));
    await pedido.save();
  }
  return NextResponse.json(registro, { status: 201 });
}
