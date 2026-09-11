import RolModel from "@/models/Rol";
import { ROLES_SEMILLA, permisosLegado, esPermisoValido } from "@/lib/permisos";
import { PUESTOS } from "@/lib/puestos";

// Los códigos conservan la identidad del puesto aunque matriz cambie su nombre.
export async function asegurarRolesSemilla() {
  const gerente = ["pos.vender", "pos.cancelar", "caja.retirar", "ventas.historial", "devoluciones.registrar", "clientes.administrar", "prestamos.operar", "pedidos.crear", "pedidos.recibir", "reportes.globales"];
  const catalogo = [
    { codigo: "admin-general", nombre: "Administrador general", anterior: "Administrador de matriz", ambito: "matriz", permisos: ROLES_SEMILLA[0].permisos, esSupervisor: false, descripcion: "Administración central: usuarios, configuración y operación de toda la cadena." },
    { codigo: "gerente-tienda", nombre: "Gerente de tienda", doc: "pos-gerente", ambito: "sucursal", permisos: gerente, esSupervisor: true, descripcion: "Supervisa tienda y caja. Opera y autoriza solo en su sucursal; consulta reportes de todas las tiendas." },
    ...PUESTOS.filter((p) => ["pos-cajero", "web-almacenista", "web-compras", "web-contabilidad", "web-inventario"].includes(p.perfilDocumentoId)).map((p) => ({ codigo: p.perfilDocumentoId, nombre: p.perfilDocumentoId === "pos-cajero" ? "Cajero" : p.nombre, doc: p.perfilDocumentoId, ambito: p.ambito, permisos: p.permisos, esSupervisor: false, descripcion: p.perfilDocumentoId === "pos-cajero" ? "Opera el punto de venta de su sucursal con NIP personal. No autoriza como supervisor." : `Puesto de ${p.nombre.toLowerCase()}. Revisa los permisos disponibles y las funciones pendientes antes de asignarlo.` })),
  ];
  if (!(await RolModel.exists({ codigoSistema: "gerente-tienda" }))) {
  await RolModel.updateMany({ codigoSistema: { $exists: false }, $or: [
    { perfilDocumentoId: { $in: ["pos-administrador", "web-administrador", "web-gerentes"] } },
    { nombre: { $in: ["Administrador de sucursal", "Encargado de turno", "Supervisor"] } },
  ] }, { $set: { retirado: true } });
  }
  // Conserva los registros anteriores para usuarios e historial; no se ofrecen para nuevas asignaciones.
  // El Cajero antiguo libera su nombre para el puesto del documento.
  await RolModel.updateOne({ nombre: "Cajero", codigoSistema: { $exists: false }, perfilDocumentoId: { $exists: false } }, { $set: { nombre: "Cajero (anterior)", retirado: true } });
  for (const c of catalogo) {
    if (await RolModel.exists({ codigoSistema: c.codigo })) continue;
    const anterior = await RolModel.findOne("doc" in c ? { perfilDocumentoId: c.doc } : { nombre: c.anterior });
    if (anterior) {
      await RolModel.updateOne({ _id: anterior._id, codigoSistema: { $exists: false } }, { $set: {
        codigoSistema: c.codigo, nombre: c.nombre, descripcion: c.descripcion, retirado: false,
        ...(c.codigo === "gerente-tienda" ? { permisos: c.permisos, esSupervisor: true } : {}),
      } });
    } else {
      try {
      await RolModel.updateOne({ codigoSistema: c.codigo }, { $setOnInsert: {
        codigoSistema: c.codigo, nombre: c.nombre, descripcion: c.descripcion, ambito: c.ambito,
        permisos: c.permisos, esSupervisor: c.esSupervisor, esSistema: true, activo: true,
        ...("doc" in c ? { perfilDocumentoId: c.doc } : {}),
      } }, { upsert: true });
      } catch (error) {
        // Dos primeras visitas pueden intentar crear el mismo puesto a la vez.
        if ((error as { code?: number }).code !== 11000 || !(await RolModel.exists({ codigoSistema: c.codigo }))) throw error;
      }
    }
  }

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
