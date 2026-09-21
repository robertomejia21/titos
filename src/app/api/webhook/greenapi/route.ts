import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || body.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true });
  }

  const chatId = body.senderData?.chatId ?? "";
  if (chatId.endsWith("@g.us")) return NextResponse.json({ ok: true });

  const phoneMatch = chatId.match(/^(\d+)@/);
  if (!phoneMatch) return NextResponse.json({ ok: true });

  const _phone = phoneMatch[1];
  const _text =
    body.messageData?.textMessageData?.textMessage ??
    body.messageData?.extendedTextMessageData?.text ??
    "";

  // ponytail: webhook stub — extend when bot replies or code verification needed
  return NextResponse.json({ ok: true });
}
