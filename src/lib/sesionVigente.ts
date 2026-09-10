import { connectDB } from "./db";
import User from "@/models/User";
import Rol from "@/models/Rol";
import { permisosLegado, esPermisoValido } from "./permisos";
import type { SessionPayload } from "./auth";

export async function sesionVigente(session: SessionPayload | null): Promise<SessionPayload | null> {
  if (!session) return null;
  await connectDB();
  const usuario = await User.findById(session.userId).select("activo role sucursalRol sucursalId rolId nombre email").lean();
  if (!usuario?.activo) return null;
  if (!usuario.rolId) return { ...session, nombre: usuario.nombre, perfilDocumentoId: undefined };
  const rol = usuario.rolId ? await Rol.findById(usuario.rolId).select("activo permisos perfilDocumentoId ambito").lean() : null;
  const invalido = !!usuario.rolId && (!rol?.activo || rol.ambito !== usuario.role);
  return {
    ...session, nombre: usuario.nombre, email: usuario.email, role: usuario.role,
    sucursalRol: usuario.sucursalRol, sucursalId: usuario.sucursalId ? String(usuario.sucursalId) : null,
    permisos: invalido ? [] : rol ? (rol.permisos ?? []).filter(esPermisoValido) : permisosLegado(usuario.role, usuario.sucursalRol),
    perfilDocumentoId: invalido ? "rol-inactivo" : rol?.perfilDocumentoId,
  };
}
