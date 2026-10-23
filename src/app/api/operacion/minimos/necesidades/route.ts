import { NextRequest, NextResponse } from "next/server";
import { sesionOperacion } from "@/lib/operacionApi";
import { generarNecesidadesBajoMinimo } from "@/lib/minimosServidor";

/** Manda a Compras lo que quedó bajo mínimo (todo, o solo los productos indicados). */
export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar");
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.productoIds) ? body.productoIds.map(String) : undefined;
  const creadas = await generarNecesidadesBajoMinimo(ids);
  return NextResponse.json({ creadas: creadas.length });
}
