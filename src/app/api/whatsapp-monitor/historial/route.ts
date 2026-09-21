import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { getChatHistory } from "@/lib/greenApi";

const PERMISO = "configuracion.editar";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return badRequest("Falta el chatId");

  try {
    const mensajes = await getChatHistory(chatId);
    return NextResponse.json({
      mensajes: mensajes.map((m) => ({
        id: m.idMessage,
        timestamp: m.timestamp,
        tipo: m.type,
        tipoMensaje: m.typeMessage,
        texto: m.textMessage ?? m.extendedTextMessage?.text ?? "",
        remitente: m.senderName ?? "",
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message, mensajes: [] }, { status: 502 });
  }
}
