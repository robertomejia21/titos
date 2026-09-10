import RolModel from "@/models/Rol";
import { ROLES_SEMILLA, permisosLegado, esPermisoValido } from "@/lib/permisos";
import { PUESTOS } from "@/lib/puestos";

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
    [...ROLES_SEMILLA, ...PUESTOS.map((p) => ({ ...p, descripcion: `Puesto establecido por Mercados Tito’s. Consulta sus permisos y funciones pendientes al asignarlo.` }))].map((rol) =>
      RolModel.updateOne(
        "perfilDocumentoId" in rol ? { perfilDocumentoId: rol.perfilDocumentoId } : { nombre: rol.nombre },
        {
          $setOnInsert: {
            nombre: rol.nombre,
            descripcion: rol.descripcion,
            ambito: rol.ambito,
            permisos: rol.permisos,
            ...("perfilDocumentoId" in rol ? { perfilDocumentoId: rol.perfilDocumentoId } : {}),
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
  // Un rol inválido nunca recupera los permisos amplios del perfil heredado.
  if (!rol || !rol.activo) return [];

  return (rol.permisos ?? []).filter(esPermisoValido);
}
