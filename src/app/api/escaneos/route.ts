import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede, sinPermiso } from "@/lib/apiAuth";
import { PUNTOS_ESCANEO, type PuntoEscaneo } from "@/lib/logistica";
import { registrarEscaneo } from "@/lib/trazabilidad";

/** Lectura de un QR: carga o acomodo desde el CEDIS, recepción desde la tienda. */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const body = await req.json().catch(() => null);
  const punto = body?.punto as PuntoEscaneo;
  if (!PUNTOS_ESCANEO.includes(punto)) return badRequest("Punto de escaneo inválido");

  if (session.role === "matriz") {
    if (!puede(session, "pedidos.surtir")) return sinPermiso("pedidos.surtir");
    if (punto === "recepcion") return badRequest("La recepción se escanea desde la tienda");
  } else {
    if (!session.sucursalId || !puede(session, "pedidos.recibir")) return forbidden();
    if (punto !== "recepcion") return badRequest("En tienda solo se escanea la recepción");
  }

  await connectDB();
  const resultado = await registrarEscaneo(session, body?.codigo, punto);
  if (!resultado) return notFound("Ese código no es de ningún folio de Titos");
  return NextResponse.json(resultado);
}
