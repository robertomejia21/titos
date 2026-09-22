import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, notFound, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "sucursal" || !session.sucursalId) return forbidden();
  if (!puede(session, "sucursal.usuarios")) return sinPermiso("sucursal.usuarios");

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();
  const usuario = await UserModel.findOne({ _id: id, role: "sucursal", sucursalId: session.sucursalId });
  if (!usuario) return notFound("Usuario no encontrado en esta sucursal");

  const esPropio = String(usuario._id) === session.userId;
  if (esPropio && ("activo" in body || "sucursalRol" in body)) {
    return badRequest("No puedes desactivar ni cambiar el rol de tu propio usuario");
  }

  if ("nombre" in body) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return badRequest("El nombre es requerido");
    usuario.nombre = nombre;
  }

  if ("usuario" in body) {
    const nuevoUsuario = String(body.usuario ?? "").trim();
    if (!nuevoUsuario) return badRequest("El usuario es requerido");
    if (await UserModel.findOne({ usuario: nuevoUsuario, _id: { $ne: usuario._id } })) {
      return conflict("Ese usuario ya está en uso por otro colaborador");
    }
    usuario.usuario = nuevoUsuario;
  }

  if ("email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email && (await UserModel.findOne({ email, _id: { $ne: usuario._id } }))) {
      return conflict("Ese correo ya está en uso por otro usuario");
    }
    usuario.email = email || null;
  }

  if ("password" in body && body.password) {
    const password = String(body.password);
    if (password.length < 6) return badRequest("La contraseña debe tener al menos 6 caracteres");
    usuario.passwordHash = await hashPassword(password);
  }

  if ("sucursalRol" in body) {
    if (!["admin", "ventas"].includes(body.sucursalRol)) return badRequest("Rol inválido");
    usuario.sucursalRol = body.sucursalRol;
  }

  if ("activo" in body) {
    usuario.activo = Boolean(body.activo);
  }

  await usuario.save();

  return NextResponse.json({
    _id: String(usuario._id),
    nombre: usuario.nombre,
    email: usuario.email,
    sucursalRol: usuario.sucursalRol,
    activo: usuario.activo,
    propio: esPropio,
  });
}
