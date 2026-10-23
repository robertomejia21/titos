import { NextRequest, NextResponse } from "next/server";
import { nuevoTokenPantalla, obtenerConfiguracionOperacion } from "@/lib/operacion";
import { sesionOperacion } from "@/lib/operacionApi";

/** Cambia la llave de la pantalla: la TV que tenía la anterior deja de ver el rol. */
export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "configuracion.editar");
  if (error) return error;
  const config = await obtenerConfiguracionOperacion();
  config.pantallaToken = nuevoTokenPantalla();
  await config.save();
  return NextResponse.json({ pantallaToken: config.pantallaToken });
}
