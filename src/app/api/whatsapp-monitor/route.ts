import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import { getChats, getLastMessages, getStateInstance } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

type Contacto = { chatId: string; nombre: string; ultimoMensaje: number };

// getChats devuelve 401 cuando la instancia ya está conectada; en ese caso el
// listado de contactos se reconstruye con los últimos mensajes, para que el
// monitor siga operando en vez de mostrar el error de Green API.
async function obtenerContactos(): Promise<Contacto[]> {
  try {
    const chats = await getChats();
    return chats
      .filter((c) => c.id.endsWith("@c.us"))
      .map((c) => ({
        chatId: c.id,
        nombre: c.name || c.id.replace("@c.us", ""),
        ultimoMensaje: c.lastMessageTimestamp,
      }));
  } catch {
    const mensajes = await getLastMessages();
    const porChat = new Map<string, Contacto>();
    for (const m of mensajes) {
      if (!m.chatId?.endsWith("@c.us")) continue;
      const ts = m.timestamp ?? 0;
      const previo = porChat.get(m.chatId);
      if (!previo || ts > previo.ultimoMensaje) {
        porChat.set(m.chatId, {
          chatId: m.chatId,
          nombre: m.chatName || m.senderName || m.chatId.replace("@c.us", ""),
          ultimoMensaje: ts,
        });
      }
    }
    return [...porChat.values()];
  }
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  try {
    // El estado de la instancia es lo que de verdad dice si WhatsApp está
    // conectado; si esto falla, la integración está caída (502).
    const state = await getStateInstance();
    const contactos = (await obtenerContactos()).sort((a, b) => b.ultimoMensaje - a.ultimoMensaje);
    return NextResponse.json({ contactos, estado: state.stateInstance });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message, contactos: [], estado: "error" },
      { status: 502 }
    );
  }
}
