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
    const map: Record<string, string> = { authorized: "open", notAuthorized: "close", sleepMode: "close" };
    return NextResponse.json({ estado: map[data.stateInstance] ?? "close", stateInstance: data.stateInstance });
  } catch (err) {
    return NextResponse.json({ estado: "close", error: (err as Error).message, diag: greenApiDiag() });
  }
}
