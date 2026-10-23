import { NextRequest, NextResponse } from "next/server";
import { sesionOperacion } from "@/lib/operacionApi";
import { rotacionPerecederos } from "@/lib/rotacion";

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar", "compras.administrar");
  if (error) return error;
  return NextResponse.json(await rotacionPerecederos());
}
