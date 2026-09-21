import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { generarTokenVerificacion, enviarVerificacionWhatsApp } from "@/lib/verificacionWhatsApp";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "usuarios.administrar")) return sinPermiso("usuarios.administrar");

  const body = await req.json().catch(() => null);
  const usuarioId = String(body?.usuarioId ?? "");
  if (!usuarioId) return badRequest("Falta el ID del usuario");

  await connectDB();

  const usuario = await UserModel.findById(usuarioId).select("nombre telefono telefonoVerificado");
  if (!usuario) return badRequest("El usuario no existe");
  if (usuario.telefonoVerificado) return badRequest("Esta cuenta ya fue verificada");
  if (!usuario.telefono) return badRequest("El usuario no tiene teléfono registrado");

  const token = generarTokenVerificacion();
  await UserModel.updateOne(
    { _id: usuario._id },
    {
      tokenVerificacion: token,
      tokenVerificacionExpira: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
  );

  await enviarVerificacionWhatsApp(usuario.telefono, usuario.nombre, token);

  return NextResponse.json({ ok: true });
}
