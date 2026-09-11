import { permisoDeRuta, tienePermiso } from "./permisos";
import type { SessionPayload } from "./auth";

export function accesoApiPuesto(s: SessionPayload, pathname: string, method: string): boolean {
  if (s.role === "sucursal" && tienePermiso(s, "reportes.globales") && ["GET", "HEAD"].includes(method) &&
    (pathname === "/api/sucursales" || pathname === "/api/cortes" || /^\/api\/reportes\/(productos|historial-ventas|arqueos)(\/pdf)?$/.test(pathname))) return true;
  if (!s.perfilDocumentoId) return true;
  const tiene = (...permisos: string[]) => permisos.some((p) => tienePermiso(s, p));
  const get = method === "GET" || method === "HEAD";
  const parte = pathname.split("/").filter(Boolean);
  const recurso = parte[1];
  if (recurso === "auth") return true;
  if (recurso === "busqueda") return get;
  if (recurso === "usuarios" || recurso === "roles") return tiene("usuarios.administrar");
  if (recurso === "configuracion") return tiene("configuracion.editar") || (get && tiene("pos.vender"));
  if (recurso === "reportes") {
    if (parte[2] === "arqueos") return get && tiene("cortes.ver");
    if (parte[2] === "productos") return get && tiene("reportes.productos");
    if (["ventas", "historial-ventas"].includes(parte[2])) return get && tiene("reportes.ventas");
    return get && tiene("reportes.ver");
  }
  if (recurso === "cortes") return get && tiene("cortes.ver", "ventas.historial");
  if (recurso === "productos") return tiene("productos.administrar") || (get && tiene("pos.vender", "inventario.administrar", "pedidos.surtir", "compras.administrar"));
  if (recurso === "producto-proveedor") return tiene("productos.administrar");
  if (recurso === "proveedores") return tiene("proveedores.administrar") || (get && tiene("compras.administrar"));
  if (["lineas", "categorias"].includes(recurso)) return tiene("catalogos.administrar") || (get && tiene("productos.administrar", "inventario.administrar", "pos.vender", "precios.actualizar"));
  if (recurso === "sucursales") {
    if (parte[3] === "usuario") return tiene("usuarios.administrar");
    return tiene("catalogos.administrar") || (get && tiene("reportes.productos", "reportes.ventas", "cortes.ver", "facturas.administrar", "usuarios.administrar", "precios.actualizar", "pedidos.surtir"));
  }
  if (["empleados", "terminales", "vales"].includes(recurso)) return tiene("catalogos.administrar") || (get && recurso !== "empleados" && tiene("pos.vender"));
  if (recurso === "inventario") return parte[2] === "entrada" && method === "POST" && tiene("inventario.administrar");
  if (recurso === "inventario-sucursal") return get && tiene("pos.vender", "inventario.administrar");
  if (recurso === "promociones" && parte[2] === "pos") return get && tiene("pos.vender");
  if (recurso === "promociones") return tiene("precios.actualizar");
  if (recurso === "actualizacion-precios") return tiene("precios.actualizar");
  if (recurso === "bitacora") return get && tiene("bitacora.ver");
  if (["ordenes-compra", "necesidades-compra", "solicitudes-producto"].includes(recurso)) return tiene("compras.administrar");
  if (recurso === "pedidos") return tiene("pedidos.surtir");
  if (recurso === "facturas") return tiene("facturas.administrar");
  if (recurso === "clientes") return tiene("clientes.administrar") || (get && tiene("pos.vender", "facturas.administrar"));
  if (recurso === "ventas") {
    if (parte[3] === "cancelar") return tiene("pos.cancelar");
    return get ? tiene("ventas.historial", "facturas.administrar") : method === "POST" && parte.length === 2 && tiene("pos.vender");
  }
  if (recurso === "cancelaciones") return tiene("pos.cancelar");
  if (recurso === "devoluciones") return tiene("devoluciones.registrar");
  if (recurso === "caja") return parte[2] === "retiros" ? tiene("caja.retirar") : tiene("pos.vender");
  if (recurso === "motivos-pos") return get ? tiene("pos.vender") : tiene("configuracion.editar");
  if (recurso === "ventas2") return tiene("notasventa.administrar");
  if (recurso === "alertas-inventario") return tiene("inventario.administrar");
  return false;
}

export function accesoPaginaPuesto(s: SessionPayload, pathname: string): boolean {
  if (!s.perfilDocumentoId) return true;
  if (pathname === "/matriz/accesos" || pathname === "/sucursal/accesos") return true;
  if (pathname === "/matriz") return tienePermiso(s, "reportes.ver");
  if (pathname === "/sucursal") return tienePermiso(s, "pos.vender");
  const permiso = permisoDeRuta(pathname);
  return !!permiso && tienePermiso(s, permiso);
}
