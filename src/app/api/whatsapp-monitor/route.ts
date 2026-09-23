import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";
import { conversacionesDe, getContacts, getLastMessages, getStateInstance, type Conversacion } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

// Ventana de los mensajes que Green API conserva para armar el listado. Un mes
// cubre la operación diaria; súbelo si hay que ver conversaciones más viejas,
// bajarlo hace la consulta más barata.
const DIAS = 31;

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

  let contactos: Conversacion[] = [];
  let error: string | undefined;
  try {
    // Primero los mensajes, que definen QUÉ conversaciones existen; la agenda
    // después y sólo para nombrarlas, así que si falla la lista sigue en pie.
    const mensajes = await getLastMessages(DIAS * 24 * 60);
    const agenda = await getContacts().catch(() => []);
    contactos = conversacionesDe(mensajes, agenda);
  } catch (e) {
    error = (e as Error).message;
  }

  return NextResponse.json({ contactos, estado, ...(error ? { error } : {}) });
}
