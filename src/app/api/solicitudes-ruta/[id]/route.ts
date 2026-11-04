import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import SolicitudRuta from "@/models/SolicitudRuta";
import RolEntrega from "@/models/RolEntrega";
import Vehiculo from "@/models/Vehiculo";
import Empleado from "@/models/Empleado";
import Sucursal from "@/models/Sucursal";
import Pedido from "@/models/Pedido";
import { badRequest, forbidden, notFound } from "@/lib/apiAuth";
import { HORA, texto } from "@/lib/operacionApi";
import { evento } from "@/lib/logistica";
import { avisarTienda, sesionSolicitudes, vistaSolicitud } from "@/lib/solicitudesRuta";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
type SalidaDoc = { _id: unknown; nombre: string; horaSalida: string; estado?: string; vehiculoId?: unknown; choferId?: unknown; pedidoIds: unknown[]; paradas: { tipo: string; sucursalId?: unknown; descripcion?: string }[] };

/**
 * CEDIS: `confirmar` en una salida del rol, `reprogramar` con otro horario o
 * marcar `entregada`. Tienda: `aceptar` el horario propuesto o `cancelar`.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await sesionSolicitudes(req);
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Solicitud no encontrada");
  const solicitud = await SolicitudRuta.findById(id);
  if (!solicitud) return notFound("Solicitud no encontrada");
  const esMatriz = session.role === "matriz";
  if (!esMatriz && String(solicitud.sucursalId) !== session.sucursalId) return notFound("Solicitud no encontrada");

  const body = await req.json().catch(() => null);
  const accion = body?.accion;
  const quien = session.nombre ?? "";
  const cerrada = solicitud.estado === "entregada" || solicitud.estado === "cancelada";
  if (cerrada) return badRequest("La solicitud ya está cerrada");
  let aviso: string | null = null;

  if (accion === "confirmar") {
    if (!esMatriz) return forbidden();
    const rol = await RolEntrega.findOne({ fecha: solicitud.fecha });
    const salida = (rol?.salidas as SalidaDoc[] | undefined)?.find((s) => String(s._id) === String(body?.salidaId));
    if (!rol || !salida) return badRequest(`Elige una salida del rol del ${solicitud.fecha}. Si no hay, arma el rol de ese día.`);
    if ((salida.estado ?? "programada") !== "programada") return badRequest(`La salida "${salida.nombre}" ya arrancó`);
    const [vehiculo, chofer, sucursal] = await Promise.all([
      salida.vehiculoId ? Vehiculo.findById(salida.vehiculoId).select("nombre refrigerado").lean() : null,
      salida.choferId ? Empleado.findById(salida.choferId).select("nombre").lean() : null,
      Sucursal.findById(solicitud.sucursalId).select("nombre").lean(),
    ]);
    if (solicitud.frio !== "ninguno" && !vehiculo?.refrigerado) return badRequest(`La entrega va ${solicitud.frio}: elige una salida con unidad refrigerada`);

    // La entrega viaja como parada de la salida, y el pedido ligado va en ella.
    const descripcion = `Entrega ${solicitud.folio} (${sucursal?.nombre ?? "tienda"}): ${solicitud.direccion}${solicitud.zona ? `, ${solicitud.zona}` : ""} · ${solicitud.horaDesde}-${solicitud.horaHasta}${solicitud.frio !== "ninguno" ? ` · ${solicitud.frio}` : ""}`;
    if (!salida.paradas.some((p) => p.descripcion?.startsWith(`Entrega ${solicitud.folio} `))) salida.paradas.push({ tipo: "otro", sucursalId: null, descripcion });
    if (solicitud.pedidoId) {
      for (const s of rol.salidas as SalidaDoc[]) s.pedidoIds = s.pedidoIds.filter((p) => String(p) !== String(solicitud.pedidoId));
      salida.pedidoIds.push(solicitud.pedidoId);
      const pedido = await Pedido.findById(solicitud.pedidoId);
      if (pedido && pedido.carga?.fechaSalida === solicitud.fecha && String(pedido.carga?.salidaId) !== String(salida._id) && ["precargado", "cargado"].includes(pedido.carga?.etapa ?? "")) {
        pedido.set("carga.salidaId", salida._id);
        pedido.historial.push(evento(session, "cambio_salida", `Ahora va en ${salida.nombre} por la solicitud ${solicitud.folio}`));
        await pedido.save();
      }
    }
    await rol.save();

    solicitud.estado = "confirmada";
    solicitud.confirmacion = {
      fecha: solicitud.fecha,
      salidaId: salida._id,
      salidaNombre: salida.nombre,
      horaSalida: salida.horaSalida,
      choferNombre: (chofer?.nombre as string | undefined) ?? "",
      vehiculoNombre: (vehiculo?.nombre as string | undefined) ?? "",
    };
    solicitud.historial.push({ porNombre: quien, texto: `Confirmada en ${salida.nombre} (sale ${solicitud.fecha} ${salida.horaSalida})` });
    aviso = `Titos CEDIS: tu solicitud de ruta ${solicitud.folio} quedó confirmada para el ${solicitud.fecha}. Sale en "${salida.nombre}" a las ${salida.horaSalida}${chofer?.nombre ? ` con ${chofer.nombre}` : ""}.`;
  } else if (accion === "reprogramar") {
    if (!esMatriz) return forbidden();
    const fecha = String(body?.fecha ?? "");
    const horaDesde = String(body?.horaDesde ?? "");
    const horaHasta = String(body?.horaHasta ?? "");
    if (!FECHA.test(fecha) || !HORA.test(horaDesde) || !HORA.test(horaHasta) || horaHasta <= horaDesde) return badRequest("Propón fecha y horario válidos");
    const comentario = texto(body?.comentario, 300);
    solicitud.estado = "reprogramada";
    solicitud.propuesta = { fecha, horaDesde, horaHasta, comentario };
    solicitud.historial.push({ porNombre: quien, texto: `Propone ${fecha} de ${horaDesde} a ${horaHasta}${comentario ? `: ${comentario}` : ""}` });
    aviso = `Titos CEDIS: no alcanzamos tu solicitud ${solicitud.folio} en el horario pedido. Te proponemos el ${fecha} de ${horaDesde} a ${horaHasta}${comentario ? ` (${comentario})` : ""}. Acéptalo o cancélalo en Solicitudes de ruta.`;
  } else if (accion === "aceptar") {
    if (esMatriz) return forbidden();
    if (solicitud.estado !== "reprogramada" || !solicitud.propuesta) return badRequest("No hay un horario propuesto que aceptar");
    solicitud.fecha = solicitud.propuesta.fecha!;
    solicitud.horaDesde = solicitud.propuesta.horaDesde!;
    solicitud.horaHasta = solicitud.propuesta.horaHasta!;
    solicitud.propuesta = null;
    solicitud.estado = "pendiente";
    solicitud.historial.push({ porNombre: quien, texto: `Aceptó el ${solicitud.fecha} de ${solicitud.horaDesde} a ${solicitud.horaHasta}` });
  } else if (accion === "cancelar") {
    if (esMatriz) return forbidden();
    solicitud.estado = "cancelada";
    solicitud.historial.push({ porNombre: quien, texto: `Canceló${body?.motivo ? `: ${texto(body.motivo, 200)}` : ""}` });
  } else if (accion === "entregada") {
    if (!esMatriz) return forbidden();
    if (solicitud.estado !== "confirmada") return badRequest("Solo se marca entregada una solicitud confirmada");
    solicitud.estado = "entregada";
    solicitud.historial.push({ porNombre: quien, texto: "Entregada" });
  } else {
    return badRequest("Acción inválida");
  }

  await solicitud.save();
  if (aviso) await avisarTienda(solicitud.sucursalId, aviso);
  return NextResponse.json(await vistaSolicitud(solicitud._id, { conOpciones: esMatriz }));
}
