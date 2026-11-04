import { NextRequest, NextResponse } from "next/server";
import SolicitudRuta, { TIPOS_FRIO } from "@/models/SolicitudRuta";
import Pedido from "@/models/Pedido";
import { badRequest, generateFolio } from "@/lib/apiAuth";
import { HORA, texto } from "@/lib/operacionApi";
import { sesionSolicitudes, vistaSolicitud, vistasSolicitudes } from "@/lib/solicitudesRuta";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { session, error } = await sesionSolicitudes(req);
  if (error) return error;
  const filtro = session.role === "matriz" ? {} : { sucursalId: session.sucursalId };
  const docs = await SolicitudRuta.find(filtro).sort({ createdAt: -1 }).limit(200).lean();
  // Primero lo que hay que atender, luego lo demás por fecha.
  const orden = ["pendiente", "reprogramada", "confirmada", "entregada", "cancelada"];
  docs.sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado) || String(a.fecha).localeCompare(String(b.fecha)));
  return NextResponse.json(await vistasSolicitudes(docs, { conOpciones: session.role === "matriz" }));
}

export async function POST(req: NextRequest) {
  const { session, error } = await sesionSolicitudes(req);
  if (error) return error;
  if (session.role !== "sucursal") return badRequest("Las solicitudes de ruta las levanta la tienda");
  const body = await req.json().catch(() => null);
  const direccion = texto(body?.direccion, 300);
  const fecha = String(body?.fecha ?? "");
  const horaDesde = String(body?.horaDesde ?? "");
  const horaHasta = String(body?.horaHasta ?? "");
  if (!direccion) return badRequest("Captura la dirección de entrega");
  if (!FECHA.test(fecha)) return badRequest("Elige la fecha de entrega");
  if (!HORA.test(horaDesde) || !HORA.test(horaHasta) || horaHasta <= horaDesde) return badRequest("Revisa el horario: desde y hasta en HH:MM, y hasta después de desde");
  const frio = TIPOS_FRIO.includes(body?.frio) ? body.frio : "ninguno";

  let pedidoId = null;
  const folioPedido = texto(body?.folioPedido, 40).toUpperCase();
  if (folioPedido) {
    const pedido = await Pedido.findOne({ folio: folioPedido, sucursalId: session.sucursalId }).select("_id").lean();
    if (!pedido) return badRequest(`No existe el pedido ${folioPedido} de tu sucursal`);
    pedidoId = pedido._id;
  }

  const solicitud = await SolicitudRuta.create({
    folio: generateFolio("SR"),
    sucursalId: session.sucursalId,
    pedidoId,
    direccion,
    zona: texto(body?.zona, 80),
    fecha,
    horaDesde,
    horaHasta,
    frio,
    notas: texto(body?.notas, 500),
    historial: [{ porNombre: session.nombre ?? "", texto: `Solicitó entrega el ${fecha} de ${horaDesde} a ${horaHasta}` }],
  });
  return NextResponse.json(await vistaSolicitud(solicitud._id), { status: 201 });
}
