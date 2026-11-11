import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, notFound, puede, sinPermiso } from "@/lib/apiAuth";
import { generarPasswordUsuario, hashPassword, verifyPassword } from "@/lib/auth";

// Las contraseñas se guardan hasheadas, así que no se pueden "leer". Lo que sí
// se puede es recalcular la autogenerada (Apellido.DDMM o usuario.Titos) y
// comprobar si sigue siendo la vigente; si alguien la cambió, matriz puede
// regenerarla para volver a la autogenerada y entregarla.

const PERMISO = "usuarios.administrar";

async function cargar(req: NextRequest, id: string) {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role !== "matriz") return { error: forbidden() };
  if (!puede(session, PERMISO)) return { error: sinPermiso(PERMISO) };

  await connectDB();
  const usuario = await UserModel.findById(id).select("usuario apellidoPaterno fechaNacimiento passwordHash eliminado");
  if (!usuario || usuario.eliminado) return { error: notFound("Usuario no encontrado") };
  if (!usuario.usuario) return { error: NextResponse.json({ error: "El usuario no tiene nombre de usuario" }, { status: 400 }) };
  const password = generarPasswordUsuario({
    usuario: usuario.usuario,
    apellidoPaterno: usuario.apellidoPaterno,
    fechaNacimiento: usuario.fechaNacimiento,
  });
  return { usuario, password };
}

// Devuelve la contraseña solo si la autogenerada sigue siendo la vigente.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await cargar(req, id);
  if ("error" in r) return r.error;
  const vigente = await verifyPassword(r.password, r.usuario.passwordHash);
  return NextResponse.json(vigente ? { vigente, password: r.password } : { vigente });
}

// Restablece la contraseña a la autogenerada y la devuelve.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await cargar(req, id);
  if ("error" in r) return r.error;
  await UserModel.updateOne({ _id: r.usuario._id }, { passwordHash: await hashPassword(r.password) });
  return NextResponse.json({ vigente: true, password: r.password });
}
