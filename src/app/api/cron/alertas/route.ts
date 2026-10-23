import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/apiAuth";
import { revisarPedidosAtrasados } from "@/lib/alertasPedidos";
import { revisarFaltantesProgramados } from "@/lib/faltantesDiarios";

// Barrido de pedidos atrasados. Lo llama el cron de Vercel (ver vercel.json), que
// manda `Authorization: Bearer $CRON_SECRET`. La frecuencia depende del plan:
// Hobby solo admite una vez al día; para revisar por hora hace falta Pro o un
// cron externo que llame a esta misma URL. Ver el README.
//
// También lo puede disparar a mano un usuario de matriz desde Configuración,
// que es la única forma de probarlo sin esperar a la siguiente hora en punto.

// El barrido consulta la base y manda WhatsApp: nunca debe servirse cacheado.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function autorizado(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.get("authorization") === `Bearer ${secreto}`) return true;

  // Sin secreto configurado el endpoint NO queda abierto: se cae a la sesión.
  const session = await requireSession(req);
  return session?.role === "matriz";
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return unauthorized();

  await connectDB();
  const resultado = await revisarPedidosAtrasados();
  // El mismo barrido manda, una vez al día, la lista de faltantes a
  // proveedores, Compras y almacén (ver Reglas de surtido).
  const faltantes = await revisarFaltantesProgramados().catch((error) => ({ enviado: false, motivo: (error as Error).message }));

  return NextResponse.json({ ...resultado, faltantes });
}
