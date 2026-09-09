export type ResultadoBusqueda = { label: string; href: string; grupo: string; palabras?: string };

export function normalizarBusqueda(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function coincideBusqueda(texto: string, consulta: string) {
  const contenido = normalizarBusqueda(texto);
  return normalizarBusqueda(consulta).trim().split(/\s+/).every((palabra) => contenido.includes(palabra));
}

export function regexBusqueda(consulta: string) {
  const vocales: Record<string, string> = { a: "[aáàä]", e: "[eéèë]", i: "[iíìï]", o: "[oóòö]", u: "[uúùü]", n: "[nñ]" };
  return new RegExp([...normalizarBusqueda(consulta)].map((c) => vocales[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(""), "i");
}

export const OPCIONES_BUSQUEDA: ResultadoBusqueda[] = [
  { label: "Tipo de cambio", href: "/matriz/configuracion#tipo-cambio", grupo: "Configuración", palabras: "pesos dolar dólares cotizacion" },
  { label: "Límites de pagos en dólares", href: "/matriz/configuracion#limites-dolares", grupo: "Configuración", palabras: "porcentaje monto denominacion billete" },
  { label: "Días laborales y hora de corte", href: "/matriz/configuracion#horarios", grupo: "Configuración", palabras: "horario pedidos" },
  { label: "IVA para facturas", href: "/matriz/configuracion#iva-facturas", grupo: "Configuración", palabras: "impuesto tasa" },
  { label: "Conexión de WhatsApp", href: "/matriz/configuracion#whatsapp", grupo: "Configuración", palabras: "vincular telefono qr" },
  { label: "Alertas de pedidos atrasados", href: "/matriz/configuracion#alertas-pedidos", grupo: "Configuración", palabras: "surtido recepcion notificaciones" },
  { label: "Avisos de inventario agotado a compras", href: "/matriz/configuracion#alertas-inventario", grupo: "Configuración", palabras: "stock cero whatsapp" },
  { label: "NIP de operaciones", href: "/matriz/configuracion#nip-operaciones", grupo: "Configuración", palabras: "clave supervisor cancelacion retiro" },
  { label: "NIP para crear supervisores", href: "/matriz/configuracion#nip-supervisores", grupo: "Configuración", palabras: "encargado turno" },
  { label: "Alta de producto", href: "/matriz/productos?accion=nuevo", grupo: "Productos", palabras: "crear agregar nuevo registrar articulo" },
  { label: "Necesidades por ordenar", href: "/matriz/ordenes-compra?tab=por-ordenar", grupo: "Compras", palabras: "faltantes resurtido" },
  { label: "Solicitudes de producto nuevo", href: "/matriz/ordenes-compra?tab=solicitudes", grupo: "Compras" },
  { label: "Pedidos pendientes por nivelar", href: "/matriz/pedidos?tab=pendiente", grupo: "Inventario" },
  { label: "Pedidos listos para surtir", href: "/matriz/pedidos?tab=nivelado", grupo: "Inventario" },
  { label: "Comparación de ventas por producto", href: "/matriz/reportes/productos", grupo: "Reportes", palabras: "rotacion variante presentacion mas menos vendido" },
];

export function opcionesBusqueda(consulta: string, role: string, puedeAbrir: (ruta: string) => boolean) {
  if (!consulta.trim()) return [];
  return OPCIONES_BUSQUEDA.filter((opcion) => opcion.href.startsWith(`/${role}/`) &&
    puedeAbrir(opcion.href.split(/[?#]/)[0]) &&
    coincideBusqueda(`${opcion.label} ${opcion.grupo} ${opcion.palabras ?? ""}`, consulta));
}
