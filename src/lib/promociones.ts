export type BorradorPromocion = {
  nombre: string;
  tipo: "porcentaje" | "monto";
  valor: number;
  alcance: "productos" | "categorias";
  productos: string[];
  categorias: string[];
  sucursales: string[];
  unidad: "todas" | "pieza" | "kg";
  inicio: string;
  fin: string;
  estado: "borrador" | "archivado";
};

export type PromocionGuardada = BorradorPromocion & {
  _id: string;
  revision: number;
  actualizadoPor: string;
  updatedAt: string;
};

function fechaValida(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
    Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor;
}

function lista(valor: unknown, ids = false): valor is string[] {
  return Array.isArray(valor) && valor.length <= 2000 && valor.every((v) => typeof v === "string" &&
    (ids ? /^[a-f\d]{24}$/i.test(v) : v.trim().length > 0 && v.length <= 200));
}

export function validarPromocion(body: unknown): BorradorPromocion {
  if (!body || typeof body !== "object") throw new Error("Revisa los datos de la promoción.");
  const b = body as Record<string, unknown>;
  if (typeof b.nombre !== "string" || !b.nombre.trim() || b.nombre.trim().length > 120) throw new Error("Escribe un nombre de hasta 120 caracteres.");
  if (b.tipo !== "porcentaje" && b.tipo !== "monto") throw new Error("Elige descuento en pesos o porcentaje.");
  if (typeof b.valor !== "number" || !Number.isFinite(b.valor) || b.valor <= 0 || b.valor > (b.tipo === "porcentaje" ? 100 : 1000000) || Math.abs(b.valor * 100 - Math.round(b.valor * 100)) > 0.000001) throw new Error("El descuento debe ser mayor que cero, con máximo dos decimales; el porcentaje no puede superar 100.");
  if (b.alcance !== "productos" && b.alcance !== "categorias") throw new Error("Elige productos o categorías.");
  if (!lista(b.productos, true) || !lista(b.categorias) || !lista(b.sucursales, true)) throw new Error("Revisa la selección de productos, categorías y sucursales.");
  if (!(b.alcance === "productos" ? b.productos : b.categorias).length || !b.sucursales.length) throw new Error("Selecciona al menos un producto o categoría y una sucursal.");
  if (!["todas", "pieza", "kg"].includes(String(b.unidad))) throw new Error("Elige piezas, kilos o ambas unidades.");
  if (!fechaValida(b.inicio) || !fechaValida(b.fin) || b.fin < b.inicio) throw new Error("La fecha final debe ser igual o posterior a la inicial.");
  if (b.estado !== "borrador" && b.estado !== "archivado") throw new Error("Por ahora solo se pueden guardar borradores o archivarlos. No se aplican en caja.");
  return {
    nombre: b.nombre.trim(), tipo: b.tipo, valor: b.valor, alcance: b.alcance,
    productos: b.alcance === "productos" ? [...new Set(b.productos)] : [],
    categorias: b.alcance === "categorias" ? [...new Set(b.categorias)] : [],
    sucursales: [...new Set(b.sucursales)], unidad: b.unidad as BorradorPromocion["unidad"],
    inicio: b.inicio, fin: b.fin, estado: b.estado,
  };
}
