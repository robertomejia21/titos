export const DOCUMENTO_PERFILES_URL = "https://base44.app/api/apps/6a5ac70f3e2b013d0fffb973/files/mp/public/6a5ac70f3e2b013d0fffb973/72f59d945_cf1f91851_PERMISOSDEPERFILES.pdf";

export type GrupoDocumento = { nombre: string; opciones: { nombre: string; marcado: boolean }[] };
export type PerfilDocumento = { id: string; nombre: string; pagina: number; grupos: GrupoDocumento[]; observaciones?: string };

function grupo(nombre: string, opciones: string, marcadas: "todas" | number[]): GrupoDocumento {
  return { nombre, opciones: opciones.split("|").map((nombre, i) => ({ nombre, marcado: marcadas === "todas" || marcadas.includes(i + 1) })) };
}

const POS_PRODUCTOS = "Buscar Producto|Buscar Productos en Sucursales|Apertura de caja|Arqueo|Corte de caja|Cierre de caja|Retiro|Devoluciones|Cambiar Precio Producto|Abrir Caja|Impresión de Etiquetas|Devolución Transacción";
const POS_CONFIGURACION = "Configuración Local|Configurar Puertos|Impresoras|Configurar Caja|Configuración Terminal de Pago";
const REIMPRESIONES = "Reimprimir Ticket Preventa|Reimprimir Ticket|Reimprimir Devolución|Reimprimir Corte|Reimprimir Factura|Reimprimir Nota de Crédito|Reimprimir Abono";
const CENTRAL = "Recepción de Productos|Pedidos|Envío Notificación|Descuentos en Tiendas|Traslado Ubicación|Descuentos en Línea|Pedidos Sucursal|Transferencia Inventario|Pantalla de Pedidos|Capturar Pedido|Devoluciones|Cambio de Precios Niveles|Autorización Mermas|Recepción de Mercancías|Ticket Corte Global|Ticket Digital|Autorización Recepción de Mercancías|Costos Productos|Devoluciones Proveedor|Reimprimir Devolución|Notas de Ventas|Búsqueda Devoluciones|Transformación Producto|Merma General";
const REPORTES = "Reporte de Salidas|Reporte de Temporada|Reporte de Mínimos|Reporte de Inventario|Reporte de Ventas|Reporte de Mermas|Reporte Kardex Global|Reporte de Existencias|Reporte de Costos|Reporte Ventas Descartadas|Reporte de Producto Detalle|Reporte de Estado de Cuenta|Reporte Costos de Productos del Inventario|Reporte de Ventas Diarias|Reporte Movimientos Inventario|Reporte Transformación de Producto|Reporte Transacciones Terminal";
const CONFIGURACIONES = "Permisos de Perfil App|Autenticación 2 Factores|Sistemas|Permisos de Perfil|Usuarios|Empleados|Configuración|Banner|Permisos de Perfil Punto de Venta|Configuración Pago Terminal|Clientes|Configuración Factura para Ventas|Configuración Sucursal|Direcciones Mayoreo|Anuncio|Cambio de Precios|Nota de Venta (primera opción)|Nota de Venta (segunda opción)|Niveles Por Línea|Diseño Etiquetas|Configuración Global POS";
const INVENTARIO = "Abrir Inventario|Ajuste Inventario|Consulta Inventario|Reiniciar Stock Áreas";
const FACTURACION = "Facturación de Ventas|Facturación Global|Complemento de pago|Créditos Clientes|Configuración de Nota de Crédito|Notas de Crédito";

// Transcripción visual del PDF definitivo, SHA-256 a70dd67405c4ee65272cdc26173cef3e6472e215a9c1eb591526e189856333a9.
// Las casillas describen el documento; no conceden permisos en la aplicación.
export const PERFILES_DOCUMENTO: PerfilDocumento[] = [
  {
    id: "pos-administrador", nombre: "POS · Administrador", pagina: 1,
    grupos: [grupo("Productos", POS_PRODUCTOS, [1,2,3,4,5,6,7,8,9,10,11]), grupo("Preventa", "Buscar Producto por Área|Preventa", "todas"), grupo("Configuración", POS_CONFIGURACION, "todas"), grupo("Facturación", "Buscar Cliente|Crédito Cliente", "todas"), grupo("Reimpresiones", REIMPRESIONES, "todas")],
  },
  {
    id: "pos-cajero", nombre: "POS · Cajer@", pagina: 2,
    grupos: [grupo("Productos", POS_PRODUCTOS, [1,2,3,4,5,6,7,8,9,10]), grupo("Preventa", "Buscar Producto por Área|Preventa", "todas"), grupo("Configuración", POS_CONFIGURACION, "todas"), grupo("Facturación", "Buscar Cliente|Crédito Cliente", "todas"), grupo("Reimpresiones", REIMPRESIONES, "todas")],
    observaciones: "Facturación y Reimpresiones muestran la casilla superior vacía, aunque sus opciones aparecen marcadas. Se conservan las marcas de cada opción; la precedencia entre padre e hijos queda pendiente de confirmar.",
  },
  {
    id: "pos-gerente", nombre: "POS · Gerente", pagina: 3,
    grupos: [grupo("Productos", POS_PRODUCTOS, [1,2,3,4,5,6,7,8,9,10,11]), grupo("Preventa", "Preventa (grupo cerrado)", []), grupo("Configuración", POS_CONFIGURACION, []), grupo("Facturación", "Buscar Cliente|Crédito Cliente", "todas"), grupo("Reimpresiones", REIMPRESIONES, "todas")],
    observaciones: "Configuración tiene la casilla superior marcada y sus cinco opciones vacías. Preventa está cerrada y no permite leer los permisos internos. Ambos detalles quedan pendientes de confirmar.",
  },
  {
    id: "web-administrador", nombre: "Web · Administrador", pagina: 4,
    grupos: [grupo("Grupos visibles", "Central|Reportes|Inventario (primer grupo)|Productos|Catálogos|Recepción de Pedido|Mermas|Recepción de Mercancía|Pendiente|Historial", "todas"), grupo("Servicios", "Ubicación Servicios|Consulta Servicios", "todas"), grupo("Orden de Compra", "Orden Compra|Autorización Orden Compra|Pedidos", "todas"), grupo("Configuraciones", CONFIGURACIONES, "todas"), grupo("Inventario (segundo grupo)", INVENTARIO, "todas"), grupo("Facturación", FACTURACION, "todas")],
    observaciones: "Los grupos cerrados no muestran sus opciones internas. El documento repite Inventario y Nota de Venta; se mantienen por separado sin asumir que son la misma función.",
  },
  {
    id: "web-almacenista", nombre: "Web · Almacenista", pagina: 5,
    grupos: [grupo("Central", CENTRAL, [1,5,8,13,14,19,24]), grupo("Reportes", REPORTES, [3,4,6,7,8,15]), grupo("Otros grupos visibles", "Inventario (primer grupo)|Servicios|Productos|Catálogos|Recepción de Pedido|Mermas|Orden de Compra|Configuraciones|Recepción de Mercancía|Pendiente|Inventario (segundo grupo)|Historial|Facturación", [6,9])],
  },
  {
    id: "web-compras", nombre: "Web · Compras", pagina: 6,
    grupos: [grupo("Central", CENTRAL, [1,4,5,6,8,10,11,12,13,14,17,18,19,20,22]), grupo("Reportes", REPORTES, "todas"), grupo("Productos", "Área|Área Producto|Equipos|Producto|Marca Producto|Productos Nuevos|Productos Locales|Alta Rápida Producto", [1,2,4,6,7,8]), grupo("Catálogos / Generales", "Tipo Venta|Unidad Medida|Tipo Producto|Contratista|Exhibidor Producto|Utilitarios|Pasillo Producto|Nivel Producto|Proveedor|Estatus Pedido|Tipo Usuario|Caja|Tipo Pago|Tipo Área|Estatus Usuario|Costo de Envío|Tipo Pasillo|Tipo Exhibidor|Tipo Ubicación|Tipo Empleado|Tipo Cambio|Vales|Proveedor de servicios", [2,3,8,9,10,15,16,17,18]), grupo("Configuraciones", CONFIGURACIONES, [16,19]), grupo("Inventario", INVENTARIO, [3]), grupo("Otros grupos visibles", "Geográficos|Recepción de Mercancía|Pendiente|Historial|Facturación", [])],
    observaciones: "Esta página no muestra el grupo Orden de Compra ni sus casillas. El nombre del puesto no se interpreta como autorización para funciones no visibles.",
  },
  {
    id: "web-contabilidad", nombre: "Web · Contabilidad", pagina: 7,
    grupos: [grupo("Central", CENTRAL, [15,16,19,20]), grupo("Reportes", REPORTES, [11,12,17]), grupo("Facturación", FACTURACION, [1,2,3,6])],
    observaciones: "Solo se muestran Central, Reportes y Facturación; los demás grupos no se consideran autorizados por omisión.",
  },
  {
    id: "web-gerentes", nombre: "Web · Gerentes", pagina: 8,
    grupos: [grupo("Central", CENTRAL, [5,8,9,10,11,13,14,15,16,19,23,24]), grupo("Reportes", REPORTES, [1,2,3,4,5,6,7,8,11,12,15,16,17]), grupo("Configuraciones", CONFIGURACIONES, [11]), grupo("Facturación", FACTURACION, [2,6]), grupo("Otros grupos visibles", "Inventario (primer grupo)|Servicios|Productos|Catálogos|Recepción de Pedido|Mermas|Orden de Compra|Recepción de Mercancía|Pendiente|Inventario (segundo grupo)|Historial", [1,6])],
  },
  {
    id: "web-inventario", nombre: "Web · Inventario", pagina: 9,
    grupos: [grupo("Central", CENTRAL, [5,8,13,14,15,19,23,24]), grupo("Reportes", REPORTES, [1,2,3,4,5,6,7,8,11,15]), grupo("Catálogos / Geográficos", "País|Estado|Ciudad|Ubicación|Zona", [4]), grupo("Inventario", INVENTARIO, "todas"), grupo("Facturación", FACTURACION, [2]), grupo("Otros grupos visibles", "Generales|Recepción de Pedido|Mermas|Orden de Compra|Configuraciones|Recepción de Mercancía|Pendiente|Historial", [3])],
  },
];
