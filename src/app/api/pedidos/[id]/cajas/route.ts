import { NextRequest, NextResponse } from "next/server";
import { badRequest } from "@/lib/apiAuth";
import { evento } from "@/lib/logistica";
import { cargarPedidoParaCajas, contenidoCaja, respuestaPedido } from "@/lib/cajasPedido";
import { nuevoQr } from "@/lib/trazabilidad";

/**
 * Arma una caja. Con los dos cinchos queda sellada de una vez (como antes);
 * sin ellos queda armada y se cierra y sella después.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { pedido, session, error } = await cargarPedidoParaCajas(req, id);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const numero = String(body?.numero ?? "").trim();
  const cincho1 = String(body?.cincho1 ?? "").trim();
  const cincho2 = String(body?.cincho2 ?? "").trim();
  const categoria = body?.categoria || "";

  if (!numero) return badRequest("Captura el número de la caja");
  if (!!cincho1 !== !!cincho2) return badRequest("Para sellar la caja se necesitan los dos números de cincho");
  const items = contenidoCaja(body?.items);
  if (typeof items === "string") return badRequest(items);

  type CajaDoc = (typeof pedido.cajas)[number];
  if (pedido.cajas.some((c: CajaDoc) => c.numero === numero)) {
    return badRequest(`Ya existe una caja con el número ${numero} en este pedido`);
  }

  const sellada = !!cincho1;
  pedido.cajas.push({ numero, estado: sellada ? "sellada" : "armada", qr: nuevoQr(), cincho1, cincho2, categoria, items });
  pedido.historial.push(evento(session, "caja_armada", `Caja ${numero}`));
  if (sellada) pedido.historial.push(evento(session, "caja_sellada", `Caja ${numero} · cinchos ${cincho1} / ${cincho2}`));
  await pedido.save();

  return NextResponse.json(await respuestaPedido(pedido._id, session), { status: 201 });
}
