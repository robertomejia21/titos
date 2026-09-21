import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { sendMessage } from "@/lib/greenApi";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "usuarios.administrar")) return sinPermiso("usuarios.administrar");

  const body = await req.json().catch(() => null);
  const usuarioId = String(body?.usuarioId ?? "");
  if (!usuarioId) return badRequest("Falta el ID del usuario");

  await connectDB();

  const usuario = await UserModel.findById(usuarioId).select("nombre telefono telefonoVerificado estadoVerificacion");
  if (!usuario) return badRequest("El usuario no existe");
  if (usuario.telefonoVerificado) return badRequest("Esta cuenta ya fue verificada");
  if (!usuario.telefono) return badRequest("El usuario no tiene teléfono registrado");

  // If stuck in esperando_password, reset to pendiente so "alta" works again
  if (usuario.estadoVerificacion === "esperando_password") {
    await UserModel.updateOne({ _id: usuario._id }, { estadoVerificacion: "pendiente" });
  }

  await sendMessage(
    usuario.telefono,
    `📲 *Titos — Activación de cuenta*\n\n` +
    `Hola *${usuario.nombre}*, tu cuenta en el sistema Titos está pendiente de activación.\n\n` +
    `Para activarla, envía la palabra *alta* a este mismo chat.\n\n` +
    `Después te pediremos que crees tu contraseña.`
  );

  return NextResponse.json({ ok: true });
}
