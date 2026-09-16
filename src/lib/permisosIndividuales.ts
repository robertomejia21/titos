import { permisosDeAmbito, tienePermiso, type AmbitoRolPermiso } from "./permisos";

export const FUNCIONES_CONSULTA = new Set(["reportes.globales", "reportes.productos", "reportes.ventas", "cortes.ver", "ventas.historial", "reportes.ver", "bitacora.ver"]);

export const DETALLE_FUNCION: Record<string, string> = {
  "reportes.globales": "Ventas, productos y cortes de otras tiendas. No permite modificar su información.",
  "reportes.productos": "Consultar ventas por producto y comparar periodos.",
  "reportes.ventas": "Consultar ventas por sucursal y descargar el historial.",
  "cortes.ver": "Consultar cortes de caja y arqueos de las sucursales.",
  "reportes.ver": "Ver el resumen de matriz y los reportes generales. Los reportes específicos se eligen por separado.",
  "bitacora.ver": "Consultar quién realizó o autorizó acciones críticas.",
  "pos.vender": "Abrir y cerrar caja, buscar productos y cobrar ventas. Las autorizaciones siguen requiriendo al gerente.",
  "pos.cancelar": "Solicitar cancelaciones y quitar productos, con la autorización configurada.",
  "caja.retirar": "Consultar y registrar retiros de efectivo, con autorización del gerente.",
  "ventas.historial": "Consultar ventas y sus comprobantes en su ubicación.",
  "devoluciones.registrar": "Consultar devoluciones, registrarlas y realizar su pago.",
  "clientes.administrar": "Consultar clientes, crear o editar sus datos y registrar abonos.",
  "pedidos.crear": "Consultar mercancía disponible y solicitarla a matriz.",
  "pedidos.recibir": "Consultar pedidos de su sucursal y confirmar lo recibido.",
  "prestamos.operar": "Consultar, solicitar y resolver préstamos entre sucursales.",
  "sucursal.usuarios": "Consultar y administrar usuarios de su sucursal. No permite cambiar permisos individuales.",
  "sucursal.ajustes": "Consultar y editar dirección y contacto de su sucursal.",
  "precios.actualizar": "Consultar y cambiar precios; crear, editar y desactivar promociones.",
  "notasventa.administrar": "Consultar y administrar las notas de venta.",
  "productos.administrar": "Consultar productos, crearlos, editar sus datos y administrar sus proveedores.",
  "proveedores.administrar": "Consultar proveedores, crearlos y editar o desactivar sus registros.",
  "catalogos.administrar": "Administrar sucursales, personal, terminales, vales, líneas y categorías. Proveedores se elige por separado.",
  "inventario.administrar": "Consultar existencias y alertas; registrar entradas al inventario central.",
  "pedidos.surtir": "Consultar, nivelar, preparar cajas y surtir pedidos desde matriz.",
  "compras.administrar": "Consultar órdenes y necesidades de compra; crear, recibir y cancelar órdenes.",
  "facturas.administrar": "Consultar, crear y administrar comprobantes internos. No habilita timbrado SAT.",
  "configuracion.editar": "Consultar y cambiar reglas del sistema, conexión de WhatsApp y correcciones de día autorizadas.",
  "usuarios.administrar": "Consultar y administrar usuarios, puestos, departamentos y permisos. Otorga control de los accesos.",
};

export function expandirPermisosPuesto(permisos: string[], ambito: AmbitoRolPermiso) {
  return permisosDeAmbito(ambito).filter((p) => tienePermiso({ permisos }, p.clave)).map((p) => p.clave);
}

export class PermisosIndividualesError extends Error {}

export function validarPermisosIndividuales(body: Record<string, unknown>, ambito: AmbitoRolPermiso) {
  const valor = body.permisosIndividuales;
  if (valor === null) {
    if (Array.isArray(body.permisosSoloConsulta) && body.permisosSoloConsulta.length) throw new PermisosIndividualesError("Para limitar funciones a consulta, personaliza primero los permisos.");
    return { permisosIndividuales: null, permisosSoloConsulta: [] };
  }
  const permitidos = new Set(permisosDeAmbito(ambito).map((p) => p.clave));
  if (!Array.isArray(valor) || valor.some((p) => typeof p !== "string" || !permitidos.has(p))) throw new PermisosIndividualesError("Hay funciones inválidas para la ubicación del usuario.");
  const consulta = body.permisosSoloConsulta ?? [];
  if (!Array.isArray(consulta) || consulta.some((p) => typeof p !== "string" || !valor.includes(p) || FUNCIONES_CONSULTA.has(p))) throw new PermisosIndividualesError("Revisa las funciones de solo consulta.");
  return { permisosIndividuales: [...new Set(valor)] as string[], permisosSoloConsulta: [...new Set(consulta)] as string[] };
}
