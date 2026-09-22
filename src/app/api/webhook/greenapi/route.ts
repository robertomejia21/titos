import { NextRequest, NextResponse } from "next/server";

// Webhook de Green API. El alta por WhatsApp (escribir "alta" y crear la
// contraseña) se retiró: ahora la contraseña se autogenera y se envía al crear
// el usuario desde el sistema. Los mensajes entrantes se ven en el Monitor de
// WhatsApp, así que aquí solo confirmamos la recepción para que Green API no
// reintente.
export async function POST(req: NextRequest) {
  await req.json().catch(() => null);
  return NextResponse.json({ ok: true });
}
