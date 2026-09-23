import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden } from "@/lib/apiAuth";
import { getQR, greenApiDiag } from "@/lib/greenApi";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  try {
    const data = await getQR();
    return NextResponse.json({ qr: data.qr, pairingCode: null });
  } catch (err) {
    const diag = greenApiDiag();
    return NextResponse.json({
      qr: null,
      error: `${(err as Error).message} · instancia:${diag.hasInstance ? "sí" : "NO"} token:${diag.hasToken ? "sí" : "NO"} host:${diag.host}`,
    });
  }
}
