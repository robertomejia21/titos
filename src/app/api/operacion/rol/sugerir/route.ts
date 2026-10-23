import { NextRequest, NextResponse } from "next/server";
import { badRequest } from "@/lib/apiAuth";
import { hoyCedis } from "@/lib/operacion";
import { sesionOperacion } from "@/lib/operacionApi";
import { sugerirRolDelDia } from "@/lib/rolDelDia";

/**
 * Genera la propuesta del día (y la guarda). `soloPedidos` deja las salidas
 * como están y solo acomoda los folios que todavía no van en ninguna.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const fecha = typeof body?.fecha === "string" && body.fecha ? body.fecha : await hoyCedis();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return badRequest("Fecha inválida");
  return NextResponse.json(await sugerirRolDelDia(fecha, session, { soloPedidos: body?.soloPedidos === true }));
}
