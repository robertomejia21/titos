import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";
import { getStateInstance } from "@/lib/greenApi";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  try {
    const data = await getStateInstance();
    const map: Record<string, string> = { authorized: "open", notAuthorized: "close", sleepMode: "close" };
    const estado = map[data.stateInstance] ?? "close";
    return NextResponse.json({ estado });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
