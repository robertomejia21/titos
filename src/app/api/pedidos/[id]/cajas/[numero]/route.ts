import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound } from "@/lib/apiAuth";
import { estadoCaja, etapaDe, evento } from "@/lib/logistica";
import { cargarPedidoParaCajas, contenidoCaja, respuestaPedido } from "@/lib/cajasPedido";

type Params = { params: Promise<{ id: string; numero: string }> };

/** Aviso que se agrega al historial si el cambio toca un folio que ya va en una unidad. */
function enUnidad(pedido: { carga?: { etapa?: string | null } | null }) {
  const etapa = etapaDe(pedido);
  return etapa === "precargado" || etapa === "cargado" ? " (cambio de último momento: el folio sigue en su unidad)" : "";
}

/**
 * Mueve una caja: `cerrar`, `sellar` (con los dos cinchos), `reabrir` para
 * rearmarla o `editar` su contenido mientras está armada.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, numero } = await params;
  const { pedido, session, error } = await cargarPedidoParaCajas(req, id);
  if (error) return error;

  type CajaDoc = (typeof pedido.cajas)[number];
  const caja = pedido.cajas.find((c: CajaDoc) => c.numero === numero);
  if (!caja) return notFound(`No existe la caja ${numero} en este pedido`);

  const body = await req.json().catch(() => null);
  const estado = estadoCaja(caja);
  const aviso = enUnidad(pedido);

  switch (body?.accion) {
    case "editar": {
      if (estado !== "armada") return badRequest("Reabre la caja antes de cambiar lo que lleva");
      const items = contenidoCaja(body.items);
      if (typeof items === "string") return badRequest(items);
      caja.items = items;
      pedido.historial.push(evento(session, "caja_editada", `Caja ${numero}: ${items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", ")}${aviso}`));
      break;
    }
    case "cerrar":
      if (estado !== "armada") return badRequest("La caja ya está cerrada");
      caja.estado = "cerrada";
      pedido.historial.push(evento(session, "caja_cerrada", `Caja ${numero}`));
      break;
    case "sellar": {
      if (estado === "sellada") return badRequest("La caja ya está sellada");
      const cincho1 = String(body.cincho1 ?? "").trim();
      const cincho2 = String(body.cincho2 ?? "").trim();
      if (!cincho1 || !cincho2) return badRequest("Se requieren los dos números de cincho para sellar la caja");
      caja.estado = "sellada";
      caja.cincho1 = cincho1;
      caja.cincho2 = cincho2;
      pedido.historial.push(evento(session, "caja_sellada", `Caja ${numero} · cinchos ${cincho1} / ${cincho2}${aviso}`));
      break;
    }
    case "reabrir": {
      if (estado === "armada") return badRequest("La caja ya está abierta");
      const motivo = String(body.motivo ?? "").trim().slice(0, 200);
      const cinchos = caja.cincho1 ? ` · se rompieron los cinchos ${caja.cincho1} / ${caja.cincho2}` : "";
      caja.estado = "armada";
      caja.cincho1 = "";
      caja.cincho2 = "";
      pedido.historial.push(evento(session, "caja_reabierta", `Caja ${numero}${cinchos}${motivo ? ` · ${motivo}` : ""}${aviso}`));
      break;
    }
    default:
      return badRequest("Acción de caja inválida");
  }

  await pedido.save();
  return NextResponse.json(await respuestaPedido(pedido._id, session));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, numero } = await params;
  const { pedido, session, error } = await cargarPedidoParaCajas(req, id);
  if (error) return error;

  type CajaDoc = (typeof pedido.cajas)[number];
  const caja = pedido.cajas.find((c: CajaDoc) => c.numero === numero);
  if (!caja) return notFound(`No existe la caja ${numero} en este pedido`);

  pedido.cajas = pedido.cajas.filter((c: CajaDoc) => c.numero !== numero) as typeof pedido.cajas;
  pedido.historial.push(evento(session, "caja_quitada", `Caja ${numero}${enUnidad(pedido)}`));
  await pedido.save();

  return NextResponse.json(await respuestaPedido(pedido._id, session));
}
