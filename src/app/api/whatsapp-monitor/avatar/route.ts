import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { getAvatar } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

// La foto se sirve por redirección en vez de proxear los bytes: la URL de
// WhatsApp es pública y firmada, así el servidor sólo gasta la llamada a Green
// API. Pasa por aquí (y no directo en el <img>) para no filtrar el token ni
// tener que declarar el host de WhatsApp en next.config.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return badRequest("Falta el chatId");

  let urlAvatar = "";
  try {
    urlAvatar = (await getAvatar(chatId)).urlAvatar ?? "";
  } catch {
    /* sin foto: el monitor dibuja las iniciales */
  }
  // Sin foto (o con privacidad activada) el 404 es la respuesta correcta: el
  // <img> falla y el componente cae a las iniciales.
  if (!urlAvatar) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(urlAvatar, {
    status: 302,
    // Una foto de perfil no cambia en una hora, y sin caché cada refresco de
    // la lista gastaría una llamada a Green API por contacto visible.
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
