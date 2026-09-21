import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { sendMessage } from "@/lib/greenApi";
import { hashPassword } from "@/lib/auth";

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const MSG_BIENVENIDA =
  `✅ *Titos — Registro de cuenta*\n\n` +
  `Tu número fue registrado en el sistema. Ahora necesitas crear tu contraseña.\n\n` +
  `Envía tu contraseña aquí. Debe cumplir:\n` +
  `• Mínimo 8 caracteres\n` +
  `• Al menos 1 letra mayúscula\n` +
  `• Al menos 1 número\n` +
  `• Al menos 1 símbolo (!@#$%&*...)`;

const MSG_PASSWORD_INVALIDA =
  `❌ La contraseña no cumple los requisitos.\n\n` +
  `Debe tener:\n` +
  `• Mínimo 8 caracteres\n` +
  `• Al menos 1 letra mayúscula (A-Z)\n` +
  `• Al menos 1 número (0-9)\n` +
  `• Al menos 1 símbolo (!@#$%&*...)\n\n` +
  `Intenta de nuevo.`;

function extraerTexto(body: Record<string, unknown>): string {
  const md = body.messageData as Record<string, unknown> | undefined;
  if (!md) return "";
  const text = (md.textMessageData as Record<string, string>)?.textMessage
    ?? (md.extendedTextMessageData as Record<string, string>)?.text
    ?? "";
  return text.trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || body.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true });
  }

  const chatId = body.senderData?.chatId ?? "";
  if (chatId.endsWith("@g.us")) return NextResponse.json({ ok: true });

  const phoneMatch = chatId.match(/^(\d+)@/);
  if (!phoneMatch) return NextResponse.json({ ok: true });

  const phone = phoneMatch[1];
  const texto = extraerTexto(body);
  if (!texto) return NextResponse.json({ ok: true });

  await connectDB();

  if (texto.toLowerCase() === "alta") {
    const usuario = await UserModel.findOne({
      telefono: phone,
      activo: false,
      telefonoVerificado: false,
      estadoVerificacion: "pendiente",
    });

    if (!usuario) {
      await sendMessage(phone, "No se encontró una cuenta pendiente de activación para este número. Contacta a tu administrador.");
      return NextResponse.json({ ok: true });
    }

    await UserModel.updateOne({ _id: usuario._id }, { estadoVerificacion: "esperando_password" });
    await sendMessage(phone, MSG_BIENVENIDA);
    return NextResponse.json({ ok: true });
  }

  const usuario = await UserModel.findOne({
    telefono: phone,
    activo: false,
    estadoVerificacion: "esperando_password",
  });

  if (!usuario) return NextResponse.json({ ok: true });

  if (!PASSWORD_REGEX.test(texto)) {
    await sendMessage(phone, MSG_PASSWORD_INVALIDA);
    return NextResponse.json({ ok: true });
  }

  await UserModel.updateOne(
    { _id: usuario._id },
    {
      passwordHash: await hashPassword(texto),
      telefonoVerificado: true,
      estadoVerificacion: "verificado",
      activo: true,
      tokenVerificacion: null,
      tokenVerificacionExpira: null,
    }
  );

  await sendMessage(
    phone,
    `🎉 *¡Cuenta activada!*\n\n` +
    `Tu contraseña fue guardada. Ya puedes iniciar sesión en el sistema Titos con tu correo *${usuario.email}* y la contraseña que acabas de crear.\n\n` +
    `No compartas tu contraseña con nadie.`
  );

  return NextResponse.json({ ok: true });
}
