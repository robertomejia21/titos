import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Empleado from "@/models/Empleado";
import RolEntrega from "@/models/RolEntrega";
import { badRequest } from "@/lib/apiAuth";
import { idONull } from "@/lib/operacionApi";
import { cajasSinSellar, etapaDe, evento, impedimentosPrecarga } from "@/lib/logistica";
import { cargarPedidoMatriz, respuestaPedido } from "@/lib/cajasPedido";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type SalidaDoc = { _id: unknown; nombre: string; horaSalida: string; estado?: string | null; pedidoIds: unknown[] };

/** Cambia campos de `carga` uno por uno (es un subdocumento: no se puede esparcir). */
function fijarCarga(pedido: { set: (ruta: string, valor: unknown) => void }, cambios: Record<string, unknown>) {
  for (const [campo, valor] of Object.entries(cambios)) pedido.set(`carga.${campo}`, valor);
}

/**
 * Pre-carga, confirmación de "vehículo cargado" y bajar de la unidad.
 *
 * La pre-carga pone el folio en una salida del rol (normalmente la del día
 * siguiente) sin tocar al chofer: el chofer se confirma cuando la salida pasa a
 * "en ruta" en el rol de entregas.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { pedido, session, error } = await cargarPedidoMatriz(req, id);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const etapa = etapaDe(pedido);
  if (etapa === "en_ruta") return badRequest("El pedido ya salió a ruta");
  if (pedido.estado === "recibido") return badRequest("El pedido ya se recibió en tienda");

  switch (body?.accion) {
    case "precargar": {
      const fecha = String(body.fecha ?? "");
      const salidaId = idONull(body.salidaId);
      if (!FECHA.test(fecha) || !salidaId) return badRequest("Elige el día y la salida en la que va el folio");
      const motivos = impedimentosPrecarga(pedido);
      if (motivos.length) return badRequest(motivos.join(". "));

      const rol = await RolEntrega.findOne({ fecha });
      const salida = rol?.salidas.find((s: SalidaDoc) => String(s._id) === salidaId);
      if (!rol || !salida) return badRequest("Esa salida ya no existe en el rol del día. Actualiza la pantalla.");
      if ((salida.estado ?? "programada") !== "programada") return badRequest(`La salida "${salida.nombre}" ya arrancó`);

      // Un folio va en una sola salida: se quita de donde estuviera (en ese día
      // y en el día de su pre-carga anterior) y se pone en la elegida.
      const anterior = pedido.carga?.fechaSalida && pedido.carga.fechaSalida !== fecha ? await RolEntrega.findOne({ fecha: pedido.carga.fechaSalida }) : null;
      for (const r of [rol, anterior].filter(Boolean)) {
        for (const s of r.salidas as SalidaDoc[]) s.pedidoIds = s.pedidoIds.filter((p) => String(p) !== String(pedido._id));
      }
      salida.pedidoIds.push(new mongoose.Types.ObjectId(String(pedido._id)));
      await rol.save();
      if (anterior) await anterior.save();

      const cambio = etapa !== "sin_cargar" && (pedido.carga?.fechaSalida !== fecha || String(pedido.carga?.salidaId) !== salidaId);
      fijarCarga(pedido, { etapa: "precargado", fechaSalida: fecha, salidaId, precargadoEn: new Date(), cargadoEn: null });
      pedido.historial.push(evento(session, cambio ? "cambio_salida" : "precargado", `${salida.nombre} · ${fecha} ${salida.horaSalida}`));
      break;
    }
    case "cargado": {
      if (etapa !== "precargado") return badRequest("Primero pre-carga el folio en una salida");
      const abiertas = cajasSinSellar(pedido);
      if (abiertas.length) return badRequest(`Falta sellar: caja ${abiertas.join(", ")}`);
      const cargadorId = idONull(body.cargadorId);
      if (body.cargadorId && !cargadorId) return badRequest("Cargador inválido");
      const cargador = cargadorId ? await Empleado.findById(cargadorId).select("nombre").lean() : null;
      if (cargadorId && !cargador) return badRequest("Ese cargador ya no existe en Personal");
      pedido.cargadorId = cargadorId;
      fijarCarga(pedido, { etapa: "cargado", cargadoEn: new Date() });
      pedido.historial.push(evento(session, "cargado", cargador ? `Cargó ${cargador.nombre}` : ""));
      break;
    }
    case "deshacer": {
      if (etapa === "sin_cargar") return badRequest("El folio no está en ninguna unidad");
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      fijarCarga(pedido, { etapa: "sin_cargar", precargadoEn: null, cargadoEn: null });
      pedido.historial.push(evento(session, "carga_deshecha", motivo));
      break;
    }
    default:
      return badRequest("Acción de carga inválida");
  }

  await pedido.save();
  return NextResponse.json(await respuestaPedido(pedido._id, session));
}
