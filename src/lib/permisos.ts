// Catálogo de permisos del sistema.
//
// Hasta ahora los permisos vivían hardcodeados en tres lugares distintos (el
// Sidebar, el proxy y un `if` en cada ruta de API) y solo existían dos perfiles
// fijos: "admin" y "ventas". Aquí quedan en una sola tabla, que es la que
// alimenta el menú, el bloqueo de rutas y la validación del servidor.
//
// Compatibilidad: los usuarios que todavía no tienen un rol asignado reciben el
// conjunto de `permisosLegado()`, que reproduce exactamente lo que podían hacer
// antes. Nadie pierde ni gana accesos al desplegar.

/**
 * "ambos" son los permisos del punto de venta: el mostrador de matriz cobra con
 * las mismas pantallas y las mismas APIs que una sucursal, así que separarlos
 * dejaría a matriz sin poder vender.
 */
export type AmbitoPermiso = "matriz" | "sucursal" | "ambos";

/** Ámbito al que pertenece un rol (un rol sí vive de un solo lado). */
export type AmbitoRolPermiso = "matriz" | "sucursal";

export type Permiso = {
  clave: string;
  etiqueta: string;
  grupo: string;
  ambito: AmbitoPermiso;
  /** Descripción de lo que habilita, para el editor de roles. */
  ayuda?: string;
};

export const PERMISOS: Permiso[] = [
  { clave: "reportes.productos", etiqueta: "Comparación y detalle de ventas por producto", grupo: "Reportes específicos", ambito: "matriz" },
  { clave: "reportes.ventas", etiqueta: "Ventas por sucursal", grupo: "Reportes específicos", ambito: "matriz" },
  { clave: "cortes.ver", etiqueta: "Consultar cortes globales", grupo: "Reportes específicos", ambito: "matriz" },
  { clave: "proveedores.administrar", etiqueta: "Administrar proveedores", grupo: "Catálogos específicos", ambito: "matriz" },
  // ---------------- Sucursal ----------------
  { clave: "pos.vender", etiqueta: "Cobrar en el punto de venta", grupo: "Punto de venta", ambito: "ambos" },
  {
    clave: "pos.cancelar",
    etiqueta: "Cancelar ventas y quitar productos",
    grupo: "Punto de venta",
    ambito: "ambos",
    ayuda: "Sigue pidiendo el NIP de supervisor si está configurado.",
  },
  { clave: "caja.retirar", etiqueta: "Retirar efectivo de la caja", grupo: "Punto de venta", ambito: "ambos" },
  { clave: "ventas.historial", etiqueta: "Consultar el historial de ventas", grupo: "Punto de venta", ambito: "ambos" },
  { clave: "devoluciones.registrar", etiqueta: "Registrar y pagar devoluciones", grupo: "Punto de venta", ambito: "ambos" },
  { clave: "clientes.administrar", etiqueta: "Administrar clientes y su crédito", grupo: "Punto de venta", ambito: "ambos" },
  { clave: "pedidos.crear", etiqueta: "Levantar pedidos a matriz", grupo: "Sucursal", ambito: "sucursal" },
  { clave: "pedidos.recibir", etiqueta: "Registrar la recepción de mercancía", grupo: "Sucursal", ambito: "sucursal" },
  { clave: "prestamos.operar", etiqueta: "Pedir y prestar entre sucursales", grupo: "Sucursal", ambito: "sucursal" },
  { clave: "sucursal.usuarios", etiqueta: "Administrar los usuarios de su sucursal", grupo: "Sucursal", ambito: "sucursal" },
  { clave: "sucursal.ajustes", etiqueta: "Editar los datos de su sucursal", grupo: "Sucursal", ambito: "sucursal" },

  // ---------------- Matriz ----------------
  { clave: "reportes.ver", etiqueta: "Ver reportes y cortes", grupo: "Reportes", ambito: "matriz" },
  { clave: "bitacora.ver", etiqueta: "Consultar la bitácora de acciones críticas", grupo: "Reportes", ambito: "matriz" },
  { clave: "precios.actualizar", etiqueta: "Actualizar precios del catálogo", grupo: "Reportes", ambito: "matriz" },
  { clave: "notasventa.administrar", etiqueta: "Administrar el protocolo de Notas de venta", grupo: "Reportes", ambito: "matriz" },
  { clave: "productos.administrar", etiqueta: "Administrar el catálogo de productos", grupo: "Catálogos", ambito: "matriz" },
  { clave: "catalogos.administrar", etiqueta: "Administrar sucursales, proveedores, personal y terminales", grupo: "Catálogos", ambito: "matriz" },
  { clave: "inventario.administrar", etiqueta: "Registrar entradas al inventario central", grupo: "Inventario", ambito: "matriz" },
  { clave: "pedidos.surtir", etiqueta: "Nivelar y surtir pedidos de sucursales", grupo: "Inventario", ambito: "matriz" },
  { clave: "compras.administrar", etiqueta: "Administrar órdenes de compra", grupo: "Compras", ambito: "matriz" },
  { clave: "facturas.administrar", etiqueta: "Emitir y administrar facturas", grupo: "Facturación", ambito: "matriz" },
  { clave: "configuracion.editar", etiqueta: "Editar la configuración del sistema", grupo: "Administración", ambito: "matriz" },
  {
    clave: "usuarios.administrar",
    etiqueta: "Administrar usuarios y roles de todo el sistema",
    grupo: "Administración",
    ambito: "matriz",
    ayuda: "Incluye crear usuarios de cualquier sucursal y definir qué puede hacer cada rol.",
  },
];

export const CLAVES_PERMISO = PERMISOS.map((p) => p.clave);

/** Permisos que se le pueden dar a un rol de este lado, incluyendo los compartidos. */
export function permisosDeAmbito(ambito: AmbitoRolPermiso) {
  return PERMISOS.filter((p) => p.ambito === ambito || p.ambito === "ambos");
}

export function esPermisoValido(clave: string) {
  return CLAVES_PERMISO.includes(clave);
}

/**
 * Ruta → permiso que se necesita para entrar. Lo usan el proxy (para bloquear
 * la navegación directa) y el Sidebar (para no mostrar lo que no se puede
 * abrir). Las rutas que no aparecen aquí solo piden estar autenticado con el
 * `role` correcto, como antes.
 *
 * El orden importa: gana la coincidencia más larga, así `/matriz/mostrador/clientes`
 * no queda atrapada por la regla de `/matriz/mostrador`.
 */
export const PERMISO_POR_RUTA: Record<string, string> = {
  "/matriz/reportes/productos": "reportes.productos",
  "/matriz/reportes/ventas": "reportes.ventas",
  "/matriz/mostrador/clientes": "clientes.administrar",
  "/matriz/mostrador/ventas": "ventas.historial",
  "/matriz/mostrador/devoluciones": "devoluciones.registrar",
  "/matriz/mostrador": "pos.vender",
  "/matriz/reportes": "reportes.ver",
  "/matriz/cancelaciones": "reportes.ver",
  "/matriz/cortes": "cortes.ver",
  "/matriz/notas-de-venta": "notasventa.administrar",
  "/matriz/actualizacion-precios": "precios.actualizar",
  "/matriz/productos": "productos.administrar",
  "/matriz/sucursales": "catalogos.administrar",
  "/matriz/proveedores": "proveedores.administrar",
  "/matriz/personal": "catalogos.administrar",
  "/matriz/terminales": "catalogos.administrar",
  "/matriz/vales": "catalogos.administrar",
  "/matriz/lineas": "catalogos.administrar",
  "/matriz/categorias": "catalogos.administrar",
  "/matriz/ordenes-compra": "compras.administrar",
  "/matriz/inventario": "inventario.administrar",
  "/matriz/pedidos": "pedidos.surtir",
  "/matriz/facturas": "facturas.administrar",
  "/matriz/configuracion": "configuracion.editar",
  "/matriz/bitacora": "bitacora.ver",
  "/matriz/usuarios": "usuarios.administrar",

  "/sucursal/productos": "pos.vender",
  "/sucursal/clientes": "clientes.administrar",
  "/sucursal/ventas": "ventas.historial",
  "/sucursal/devoluciones": "devoluciones.registrar",
  "/sucursal/notas-de-venta": "ventas.historial",
  "/sucursal/prestamos": "prestamos.operar",
  "/sucursal/nuevo-pedido": "pedidos.crear",
  "/sucursal/pedidos": "pedidos.recibir",
  "/sucursal/usuarios": "sucursal.usuarios",
  "/sucursal/ajustes": "sucursal.ajustes",
};

/** Permiso exigido por una ruta, tomando la coincidencia más específica. */
export function permisoDeRuta(pathname: string): string | null {
  let mejor: { ruta: string; permiso: string } | null = null;
  for (const [ruta, permiso] of Object.entries(PERMISO_POR_RUTA)) {
    if (pathname !== ruta && !pathname.startsWith(`${ruta}/`)) continue;
    if (!mejor || ruta.length > mejor.ruta.length) mejor = { ruta, permiso };
  }
  return mejor?.permiso ?? null;
}

// --- Perfiles de arranque -----------------------------------------------------
// Reproducen exactamente lo que cada perfil podía hacer antes de que existieran
// los roles configurables. Sirven como semilla de los roles del sistema y como
// respaldo para los usuarios que todavía no tienen rol asignado.

const PERMISOS_MATRIZ_COMPLETO = permisosDeAmbito("matriz").map((p) => p.clave);

const PERMISOS_SUCURSAL_ADMIN = permisosDeAmbito("sucursal").map((p) => p.clave);

/** El perfil "ventas" solo veía el punto de venta y el historial. */
const PERMISOS_SUCURSAL_VENTAS = ["pos.vender", "pos.cancelar", "caja.retirar", "ventas.historial"];

/**
 * El supervisor de piso: manda sobre el mostrador (cancela, retira, resuelve
 * devoluciones y clientes) pero no administra la sucursal ni a su gente.
 */
const PERMISOS_SUPERVISOR = [
  ...PERMISOS_SUCURSAL_VENTAS,
  "devoluciones.registrar",
  "clientes.administrar",
  "prestamos.operar",
];

export const ROLES_SEMILLA = [
  {
    nombre: "Administrador de matriz",
    ambito: "matriz" as const,
    permisos: PERMISOS_MATRIZ_COMPLETO,
    descripcion: "Acceso completo a la administración central.",
    esSupervisor: false,
  },
  {
    nombre: "Administrador de sucursal",
    ambito: "sucursal" as const,
    permisos: PERMISOS_SUCURSAL_ADMIN,
    descripcion: "Todo lo de una sucursal: punto de venta, clientes, pedidos y sus usuarios.",
    esSupervisor: false,
  },
  {
    nombre: "Encargado de turno",
    ambito: "sucursal" as const,
    permisos: PERMISOS_SUPERVISOR,
    descripcion: "Manda en el mostrador: cancelaciones, retiros, devoluciones y clientes.",
    // Dar de alta a alguien con este rol exige el NIP de creación de matriz, y
    // a cada encargado se le asigna además su propio NIP de 6 dígitos con el
    // que autoriza cancelaciones y retiros.
    esSupervisor: true,
  },
  {
    nombre: "Cajero",
    ambito: "sucursal" as const,
    permisos: PERMISOS_SUCURSAL_VENTAS,
    descripcion: "Solo el punto de venta y la consulta de ventas del día.",
    esSupervisor: false,
  },
];

/**
 * Permisos de un usuario que todavía no tiene rol asignado, deducidos de los
 * campos viejos. Es lo que garantiza que al desplegar nadie se quede fuera.
 */
export function permisosLegado(role?: string | null, sucursalRol?: string | null): string[] {
  if (role === "matriz") return [...PERMISOS_MATRIZ_COMPLETO];
  if (role === "sucursal") {
    return sucursalRol === "ventas" ? [...PERMISOS_SUCURSAL_VENTAS] : [...PERMISOS_SUCURSAL_ADMIN];
  }
  return [];
}

/**
 * Permisos efectivos de una sesión. Un token viejo (emitido antes de que
 * existieran los roles) no trae la lista: en ese caso se deducen igual que
 * antes, para que la sesión abierta siga funcionando hasta que expire.
 */
export function permisosDeSesion(sesion: {
  role?: string | null;
  sucursalRol?: string | null;
  permisos?: string[] | null;
}): string[] {
  if (Array.isArray(sesion.permisos)) return sesion.permisos;
  return permisosLegado(sesion.role, sesion.sucursalRol);
}

export function tienePermiso(
  sesion: { role?: string | null; sucursalRol?: string | null; permisos?: string[] | null },
  clave: string
) {
  const permisos = permisosDeSesion(sesion);
  const grupos: Record<string, string> = {
    "reportes.productos": "reportes.ver",
    "reportes.ventas": "reportes.ver",
    "cortes.ver": "reportes.ver",
    "proveedores.administrar": "catalogos.administrar",
  };
  return permisos.includes(clave) || !!(grupos[clave] && permisos.includes(grupos[clave]));
}
