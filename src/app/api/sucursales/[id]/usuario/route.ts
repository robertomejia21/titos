import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();
  const usuario = await UserModel.findOne({ role: "sucursal", sucursalId: id });
  if (!usuario) return notFound("No hay un usuario de acceso ligado a esta sucursal");

  if (body.nombre) usuario.nombre = body.nombre;

  if (body.usuario) {
    const nuevoUsuario = String(body.usuario).trim();
    if (await UserModel.findOne({ usuario: nuevoUsuario, _id: { $ne: usuario._id } })) {
      return badRequest("Ese usuario ya está en uso por otro colaborador");
    }
    usuario.usuario = nuevoUsuario;
  }

  if (body.email) {
    const email = String(body.email).toLowerCase().trim();
    const yaExiste = await UserModel.findOne({ email, _id: { $ne: usuario._id } });
    if (yaExiste) return badRequest("Ese correo ya está en uso por otro usuario");
    usuario.email = email;
  }

  if (body.password) {
    usuario.passwordHash = await hashPassword(body.password);
  }

  await usuario.save();

  return NextResponse.json({ email: usuario.email, nombre: usuario.nombre });
}
