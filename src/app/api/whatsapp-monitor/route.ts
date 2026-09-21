import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import { getChats, getStateInstance } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  try {
    const [chats, state] = await Promise.all([getChats(), getStateInstance()]);
    const contactos = chats
      .filter((c) => c.id.endsWith("@c.us"))
      .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp)
      .map((c) => ({
        chatId: c.id,
        nombre: c.name || c.id.replace("@c.us", ""),
        ultimoMensaje: c.lastMessageTimestamp,
      }));
    return NextResponse.json({ contactos, estado: state.stateInstance });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message, contactos: [], estado: "error" },
      { status: 502 }
    );
  }
}
