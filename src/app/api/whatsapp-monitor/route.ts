import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import { getChats, getContacts, getLastMessages, getStateInstance, nombreDeContacto } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

type Contacto = {
  chatId: string;
  nombre: string;
  numero: string;
  nombrePerfil: string;
  ultimoMensaje: number;
};

// getChats devuelve 401 cuando la instancia ya está conectada; en ese caso el
// listado de contactos se reconstruye con los últimos mensajes, para que el
// monitor siga operando en vez de mostrar el error de Green API.
const numero = (chatId: string) => chatId.replace("@c.us", "");

function contacto(chatId: string, nombrePerfil: string, ultimoMensaje: number): Contacto {
  return {
    chatId,
    nombre: nombrePerfil || numero(chatId),
    numero: numero(chatId),
    nombrePerfil,
    ultimoMensaje,
  };
}

async function obtenerContactos(): Promise<Contacto[]> {
  try {
    const chats = await getChats();
    return chats
      .filter((c) => c.id.endsWith("@c.us"))
      .map((c) => contacto(c.id, c.name ?? "", c.lastMessageTimestamp));
  } catch {
    const mensajes = await getLastMessages();
    const porChat = new Map<string, Contacto>();
    for (const m of mensajes) {
      if (!m.chatId?.endsWith("@c.us")) continue;
      const ts = m.timestamp ?? 0;
      const previo = porChat.get(m.chatId);
      if (!previo || ts > previo.ultimoMensaje) {
        porChat.set(m.chatId, contacto(m.chatId, m.chatName || m.senderName || "", ts));
      }
    }
    return [...porChat.values()];
  }
}

// El nombre que el operador reconoce es el de la agenda del teléfono, no el
// que cada quien se puso en su perfil de WhatsApp. Si la agenda no se puede
// leer, la lista sigue con el nombre de perfil en vez de quedarse vacía.
async function conNombresDeAgenda(contactos: Contacto[]): Promise<Contacto[]> {
  let agenda: Awaited<ReturnType<typeof getContacts>>;
  try {
    agenda = await getContacts();
  } catch {
    return contactos;
  }
  const porId = new Map(agenda.map((c) => [c.id, c]));
  return contactos.map((c) => {
    const enAgenda = porId.get(c.chatId);
    return {
      ...c,
      nombrePerfil: c.nombrePerfil || enAgenda?.name || "",
      nombre: nombreDeContacto(c.numero, c.nombrePerfil, enAgenda),
    };
  });
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  let estado = "notAuthorized";
  try {
    const state = await getStateInstance();
    estado = state.stateInstance;
  } catch { /* keep default */ }

  let contactos: Contacto[] = [];
  let error: string | undefined;
  try {
    contactos = (await conNombresDeAgenda(await obtenerContactos()))
      .sort((a, b) => b.ultimoMensaje - a.ultimoMensaje);
  } catch (e) {
    error = (e as Error).message;
  }

  return NextResponse.json({ contactos, estado, ...(error ? { error } : {}) });
}
