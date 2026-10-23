import { NextRequest, NextResponse } from "next/server";
import EnvioFaltantes from "@/models/EnvioFaltantes";
import { sesionOperacion } from "@/lib/operacionApi";
import { armarFaltantesDelDia, enviarFaltantesDelDia } from "@/lib/faltantesDiarios";

/** Vista previa de la lista de hoy y si ya se mandó. */
export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "compras.administrar");
  if (error) return error;
  const datos = await armarFaltantesDelDia();
  const envio = await EnvioFaltantes.findOne({ fecha: datos.fecha }).lean();
  return NextResponse.json({ ...datos, envio });
}

/** Envío manual (también reenvía si ya se había mandado). */
export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "compras.administrar");
  if (error) return error;
  return NextResponse.json(await enviarFaltantesDelDia({ origen: "manual", forzar: true }));
}
