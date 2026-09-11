export type BorradorPromocion = {
  nombre: string;
  tipo: "porcentaje" | "monto" | "combinacion";
  valor: number;
  alcance: "productos" | "categorias" | "areas";
  productos: string[];
  categorias: string[];
  areas?: string[];
  combinada?: boolean;
  lleva?: number;
  bonifica?: number;
  porcentajeBeneficio?: number;
  prioridad?: number;
  sucursales: string[];
  unidad: "todas" | "pieza" | "kg";
  inicio: string;
  fin: string;
  estado: "borrador" | "archivado" | "activa";
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
  if (b.tipo !== "porcentaje" && b.tipo !== "monto" && b.tipo !== "combinacion") throw new Error("Elige descuento en pesos o porcentaje.");
  if (b.tipo !== "combinacion" && (typeof b.valor !== "number" || !Number.isFinite(b.valor) || b.valor <= 0 || b.valor > (b.tipo === "porcentaje" ? 100 : 1000000) || Math.abs(b.valor * 100 - Math.round(b.valor * 100)) > 0.000001)) throw new Error("El descuento debe ser mayor que cero, con máximo dos decimales; el porcentaje no puede superar 100.");
  if (b.alcance !== "productos" && b.alcance !== "categorias" && b.alcance !== "areas") throw new Error("Elige productos o categorías.");
  if (!lista(b.productos, true) || !lista(b.categorias) || !lista(b.sucursales, true)) throw new Error("Revisa la selección de productos, categorías y sucursales.");
  if (!lista(b.areas ?? [])) throw new Error("Revisa las áreas seleccionadas.");
  if (!(b.alcance === "productos" ? b.productos : b.alcance === "categorias" ? b.categorias : b.areas as string[]).length || !b.sucursales.length) throw new Error("Selecciona al menos un producto o categoría y una sucursal.");
  if (!["todas", "pieza", "kg"].includes(String(b.unidad))) throw new Error("Elige piezas, kilos o ambas unidades.");
  if (!fechaValida(b.inicio) || !fechaValida(b.fin) || b.fin < b.inicio) throw new Error("La fecha final debe ser igual o posterior a la inicial.");
  if (b.estado !== "borrador" && b.estado !== "archivado" && b.estado !== "activa") throw new Error("Elige borrador, activa o archivada.");
  const prioridad = b.prioridad ?? 100;
  if (typeof prioridad !== "number" || !Number.isInteger(prioridad) || prioridad < 1 || prioridad > 999) throw new Error("La prioridad debe ser un número entero entre 1 y 999.");
  if (b.tipo === "combinacion") {
    if (b.unidad === "todas") throw new Error("Para una combinación elige piezas o kilos; no se mezclan unidades.");
    for (const campo of ["lleva", "bonifica"]) {
      const n = b[campo];
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 10000 || Math.abs(n * 1000 - Math.round(n * 1000)) > 0.00001 || (b.unidad === "pieza" && !Number.isInteger(n))) throw new Error("Captura cantidades válidas: piezas enteras o kilos con hasta tres decimales.");
    }
    if ((b.bonifica as number) >= (b.lleva as number)) throw new Error("La cantidad con descuento debe ser menor que la cantidad total que lleva el cliente.");
    if (typeof b.porcentajeBeneficio !== "number" || !Number.isFinite(b.porcentajeBeneficio) || b.porcentajeBeneficio <= 0 || b.porcentajeBeneficio > 100) throw new Error("El porcentaje del beneficio debe estar entre 0 y 100.");
    if (typeof b.combinada !== "boolean") throw new Error("Elige si se pueden combinar productos.");
  }
  return {
    nombre: b.nombre.trim(), tipo: b.tipo, valor: b.tipo === "combinacion" ? 0 : b.valor as number, alcance: b.alcance,
    productos: b.alcance === "productos" ? [...new Set(b.productos)] : [],
    categorias: b.alcance === "categorias" ? [...new Set(b.categorias)] : [],
    areas: b.alcance === "areas" ? [...new Set(b.areas as string[])] : [],
    combinada: b.combinada === true, lleva: b.tipo === "combinacion" ? b.lleva as number : 2,
    bonifica: b.tipo === "combinacion" ? b.bonifica as number : 1,
    porcentajeBeneficio: b.tipo === "combinacion" ? b.porcentajeBeneficio as number : 100, prioridad,
    sucursales: [...new Set(b.sucursales)], unidad: b.unidad as BorradorPromocion["unidad"],
    inicio: b.inicio, fin: b.fin, estado: b.estado,
  };
}
