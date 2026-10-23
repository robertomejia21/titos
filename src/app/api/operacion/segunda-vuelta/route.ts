import { NextRequest, NextResponse } from "next/server";
import { sesionOperacion } from "@/lib/operacionApi";
import { generarSegundaVuelta, pedidosConFaltante } from "@/lib/segundaVuelta";

/** Pedidos de los últimos días que quedaron cortos y lo que hay hoy para completarlos. */
export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  return NextResponse.json(await pedidosConFaltante());
}

/** Arma los complementos con la existencia actual (todos, o solo los pedidos indicados). */
export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const pedidoIds = Array.isArray(body?.pedidoIds) ? body.pedidoIds.map(String) : undefined;
  return NextResponse.json(await generarSegundaVuelta({ pedidoIds }));
}
