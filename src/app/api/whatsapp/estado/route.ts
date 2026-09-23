import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";
import { getStateInstance, greenApiDiag } from "@/lib/greenApi";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  // Responde 200 siempre: un 502 sólo deja "Bad Gateway" en la consola y
  // esconde el mensaje de Green API, que es justo lo que hace falta leer.
  try {
    const data = await getStateInstance();
    const map: Record<string, string> = {
      authorized: "open",
      starting: "connecting",
      notAuthorized: "close",
      sleepMode: "close",
      blocked: "close",
      suspended: "close",
      yellowCard: "close",
    };
    // Una instancia bloqueada o suspendida no se arregla escaneando un QR, así
    // que se distingue de la que sólo está sin vincular.
    const aviso: Record<string, string> = {
      blocked: "La instancia está bloqueada en Green API. Escanear el QR no lo resuelve: revisa la cuenta.",
      suspended: "La instancia está suspendida en Green API (normalmente por pago o límite de plan).",
      sleepMode: "La instancia está en modo reposo en Green API.",
    };
    return NextResponse.json({
      estado: map[data.stateInstance] ?? "close",
      stateInstance: data.stateInstance,
      ...(aviso[data.stateInstance] ? { error: aviso[data.stateInstance] } : {}),
    });
  } catch (err) {
    return NextResponse.json({ estado: "close", error: (err as Error).message, diag: greenApiDiag() });
  }
}
