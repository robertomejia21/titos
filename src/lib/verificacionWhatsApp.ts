import crypto from "crypto";
import { sendMessage } from "@/lib/greenApi";

export function generarTokenVerificacion(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generarCodigoVerificacion(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function urlVerificacion(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return `${base}/verificar?token=${token}`;
}

export async function enviarVerificacionWhatsApp(
  telefono: string,
  nombreUsuario: string,
  token: string
) {
  const link = urlVerificacion(token);
  const mensaje =
    `🔐 *Verificación de cuenta — Titos*\n\n` +
    `Hola, se ha creado una cuenta para *${nombreUsuario}* en el sistema Titos.\n\n` +
    `Para activar tu acceso, abre este enlace:\n${link}\n\n` +
    `Este enlace expira en 24 horas. Si no solicitaste esta cuenta, ignora este mensaje.`;

  return sendMessage(telefono, mensaje);
}
