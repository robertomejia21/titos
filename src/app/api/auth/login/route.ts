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
  const escLogin = usuario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidatos = await UserModel.find({
    activo: true,
    $or: [
      { usuario },
      { email: usuario.toLowerCase() },
      { usuario: { $regex: `^${escLogin}$`, $options: "i" } },
      { nombre: { $regex: `^${escLogin}$`, $options: "i" } },
    ],
  }).limit(20).lean();
  const exactos = candidatos.filter((c) => c.usuario === usuario || c.email === usuario.toLowerCase());
  let cuenta: (typeof candidatos)[number] | null = null;
  for (const c of exactos.length ? exactos : candidatos) {
    if (await verifyPassword(password, c.passwordHash)) {
      cuenta = c;
      break;
    }
  }
  if (!cuenta) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  // Los roles del sistema se crean solos la primera vez que alguien entra, para
  // no depender de un script de migración manual.
  await asegurarRolesSemilla();

  const token = await signSession({
    userId: String(cuenta._id),
    email: cuenta.email ?? null,
    nombre: cuenta.nombre,
    role: cuenta.role as "matriz" | "sucursal",
    sucursalRol: cuenta.role === "sucursal" ? ((cuenta.sucursalRol as "admin" | "ventas") ?? "admin") : null,
    sucursalId: cuenta.sucursalId ? String(cuenta.sucursalId) : null,
    permisos: await permisosDeUsuario(cuenta),
    permisosIndividuales: Array.isArray(cuenta.permisosIndividuales),
    permisosSoloConsulta: cuenta.permisosSoloConsulta ?? [],
  });

  const res = NextResponse.json({
    role: cuenta.role,
    nombre: cuenta.nombre,
    sucursalId: cuenta.sucursalId ? String(cuenta.sucursalId) : null,
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
