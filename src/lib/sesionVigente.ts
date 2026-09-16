import { connectDB } from "./db";
import User from "@/models/User";
import Rol from "@/models/Rol";
import { permisosLegado, esPermisoValido } from "./permisos";
import type { SessionPayload } from "./auth";

export async function sesionVigente(session: SessionPayload | null): Promise<SessionPayload | null> {
  if (!session) return null;
  await connectDB();
  const usuario = await User.findById(session.userId).select("activo role sucursalRol sucursalId rolId nombre email permisosIndividuales permisosSoloConsulta").lean();
  if (!usuario?.activo) return null;
  const rol = usuario.rolId ? await Rol.findById(usuario.rolId).select("activo permisos perfilDocumentoId ambito").lean() : null;
  const invalido = !!usuario.rolId && (!rol?.activo || rol.ambito !== usuario.role);
  return {
    ...session, nombre: usuario.nombre, email: usuario.email, role: usuario.role,
    sucursalRol: usuario.sucursalRol, sucursalId: usuario.sucursalId ? String(usuario.sucursalId) : null,
    permisosIndividuales: Array.isArray(usuario.permisosIndividuales),
    permisosSoloConsulta: usuario.permisosSoloConsulta ?? [],
    permisos: invalido ? [] : Array.isArray(usuario.permisosIndividuales) ? usuario.permisosIndividuales.filter(esPermisoValido) : rol ? (rol.permisos ?? []).filter(esPermisoValido) : permisosLegado(usuario.role, usuario.sucursalRol),
    perfilDocumentoId: invalido ? "rol-inactivo" : rol?.perfilDocumentoId,
  };
}
