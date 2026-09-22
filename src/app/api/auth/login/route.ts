import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { SESSION_COOKIE, signSession, verifyPassword } from "@/lib/auth";
import { badRequest } from "@/lib/apiAuth";
import { asegurarRolesSemilla, permisosDeUsuario } from "@/lib/roles";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const usuario = body?.usuario?.toString().trim();
  const password = body?.password?.toString();

  if (!usuario || !password) {
    return badRequest("Usuario y contraseña son requeridos");
  }

  await connectDB();
  const user = await UserModel.findOne({ $or: [{ usuario }, { email: usuario.toLowerCase() }], activo: true }).lean();

  if (!user) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  // Los roles del sistema se crean solos la primera vez que alguien entra, para
  // no depender de un script de migración manual.
  await asegurarRolesSemilla();

  const token = await signSession({
    userId: String(user._id),
    email: user.email ?? null,
    nombre: user.nombre,
    role: user.role as "matriz" | "sucursal",
    sucursalRol: user.role === "sucursal" ? ((user.sucursalRol as "admin" | "ventas") ?? "admin") : null,
    sucursalId: user.sucursalId ? String(user.sucursalId) : null,
    permisos: await permisosDeUsuario(user),
    permisosIndividuales: Array.isArray(user.permisosIndividuales),
    permisosSoloConsulta: user.permisosSoloConsulta ?? [],
  });

  const res = NextResponse.json({
    role: user.role,
    nombre: user.nombre,
    sucursalId: user.sucursalId ? String(user.sucursalId) : null,
  });

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return res;
}
