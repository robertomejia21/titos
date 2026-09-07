import RolModel from "@/models/Rol";
import { ROLES_SEMILLA, permisosLegado, esPermisoValido } from "@/lib/permisos";

// Resolución y semilla de los roles configurables.

/**
 * Crea (una sola vez) los roles que reproducen los perfiles con los que ya venía
 * operando el sistema. Se llama al abrir la pantalla de usuarios, para no
 * depender de un script de migración que alguien tenga que acordarse de correr.
 *
 * `$setOnInsert` es deliberado: si matriz ya editó los permisos de un rol
 * semilla, un despliegue posterior no debe pisárselos.
 */
export async function asegurarRolesSemilla() {
  await Promise.all(
    ROLES_SEMILLA.map((rol) =>
      RolModel.updateOne(
        { nombre: rol.nombre },
        {
          $setOnInsert: {
            nombre: rol.nombre,
            descripcion: rol.descripcion,
            ambito: rol.ambito,
            permisos: rol.permisos,
            esSupervisor: rol.esSupervisor,
            esSistema: true,
            activo: true,
          },
        },
        { upsert: true }
      )
    )
  );
}

type UsuarioParaPermisos = {
  role?: string | null;
  sucursalRol?: string | null;
  rolId?: unknown;
};

/**
 * Permisos efectivos de un usuario.
 *
 * Con rol asignado manda el rol; sin él se cae al comportamiento anterior, que
 * es lo que mantiene funcionando a todos los usuarios que ya existían.
 */
export async function permisosDeUsuario(usuario: UsuarioParaPermisos): Promise<string[]> {
  if (!usuario.rolId) return permisosLegado(usuario.role, usuario.sucursalRol);

  const rol = await RolModel.findById(usuario.rolId).select("permisos activo").lean();
  // Un rol desactivado o borrado no debe dejar al usuario sin poder trabajar:
  // se cae al perfil heredado en lugar de dejarlo con cero permisos.
  if (!rol || !rol.activo) return permisosLegado(usuario.role, usuario.sucursalRol);

  return (rol.permisos ?? []).filter(esPermisoValido);
}
