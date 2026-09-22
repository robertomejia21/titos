import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword, generarPasswordUsuario } from "@/lib/auth";
import { enviarBienvenida } from "@/lib/onboarding";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "usuarios.administrar")) return sinPermiso("usuarios.administrar");

  const body = await req.json().catch(() => null);
  const usuarioId = String(body?.usuarioId ?? "");
  if (!usuarioId) return badRequest("Falta el ID del usuario");

  await connectDB();

  const usuario = await UserModel.findById(usuarioId).select("nombre usuario telefono apellidoPaterno fechaNacimiento");
  if (!usuario) return badRequest("El usuario no existe");
  if (!usuario.telefono) return badRequest("El usuario no tiene teléfono registrado");
  if (!usuario.usuario || !usuario.apellidoPaterno || !usuario.fechaNacimiento) {
    return badRequest("A este usuario le faltan datos (usuario, apellido paterno o fecha de nacimiento) para generar su contraseña");
  }

  // La contraseña es determinista; se regenera y se re-sincroniza el hash para
  // garantizar que lo que se envía es lo que sirve para entrar.
  const passwordPlano = generarPasswordUsuario(usuario.apellidoPaterno, usuario.fechaNacimiento);
  await UserModel.updateOne({ _id: usuario._id }, { passwordHash: await hashPassword(passwordPlano) });

  await enviarBienvenida({
    telefono: usuario.telefono,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    password: passwordPlano,
  });

  return NextResponse.json({ ok: true });
}
