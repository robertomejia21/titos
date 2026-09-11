import type { BorradorPromocion } from "./promociones";
export type ReglaPromocion = BorradorPromocion & { _id: string };
export type ProductoPromocion = { productoId: string; cantidad: number; precio: number; unidad: string; categoria?: string; area?: string };
const centavos = (n: number) => Math.round(n * 100);

export function calcularPromociones(items: ProductoPromocion[], reglas: ReglaPromocion[], dia: string) {
  const lineas = items.map((i) => ({ productoId: i.productoId, bruto: centavos(i.precio * i.cantidad), descuento: 0, promocionId: "", promocionNombre: "" }));
  const ocupados = new Set<string>();
  const ordenadas = reglas.filter((r) => r.estado === "activa" && r.inicio <= dia && r.fin >= dia).sort((a, b) => (a.prioridad ?? 100) - (b.prioridad ?? 100) || a._id.localeCompare(b._id));
  for (const r of ordenadas) {
    const elegibles = items.map((item, index) => ({ ...item, index })).filter((i) => !ocupados.has(i.productoId) && (r.unidad === "todas" || r.unidad === i.unidad) &&
      (r.alcance === "productos" ? r.productos.includes(i.productoId) : r.alcance === "categorias" ? r.categorias.includes(i.categoria ?? "") : (r.areas ?? []).includes(i.area ?? "")));
    const descuentos = new Map<number, number>();
    if (r.tipo === "combinacion") {
      const grupos = new Map<string, typeof elegibles>();
      for (const i of elegibles) { const key = r.combinada ? i.unidad : i.productoId; grupos.set(key, [...(grupos.get(key) ?? []), i]); }
      for (const grupo of grupos.values()) {
        const total = grupo.reduce((s, i) => s + Math.round(i.cantidad * 1000), 0);
        const veces = Math.floor(total / Math.round((r.lleva ?? 2) * 1000));
        let bonificados = veces * Math.round((r.bonifica ?? 1) * 1000);
        if (!bonificados) continue;
        for (const i of [...grupo].sort((a, b) => a.precio - b.precio || a.productoId.localeCompare(b.productoId))) {
          const cantidad = Math.min(bonificados, Math.round(i.cantidad * 1000));
          const descuento = centavos(i.precio * cantidad / 1000 * (r.porcentajeBeneficio ?? 100) / 100);
          descuentos.set(i.index, descuento);
          bonificados -= cantidad;
        }
        // Los artículos que completan una combinación tampoco participan en otra promoción.
        for (const i of grupo) ocupados.add(i.productoId);
      }
    } else {
      for (const i of elegibles) descuentos.set(i.index, r.tipo === "porcentaje" ? Math.round(lineas[i.index].bruto * r.valor / 100) : centavos(r.valor * i.cantidad));
    }
    for (const [index, monto] of descuentos) {
      const linea = lineas[index];
      linea.descuento = Math.min(linea.bruto, Math.max(0, monto));
      if (linea.descuento > 0) { linea.promocionId = r._id; linea.promocionNombre = r.nombre; ocupados.add(linea.productoId); }
    }
  }
  const resultado = lineas.map((l) => ({ ...l, bruto: l.bruto / 100, descuento: l.descuento / 100, total: (l.bruto - l.descuento) / 100 }));
  const bruto = lineas.reduce((s, l) => s + l.bruto, 0) / 100;
  const descuento = lineas.reduce((s, l) => s + l.descuento, 0) / 100;
  return { lineas: resultado, bruto, descuento, total: (centavos(bruto) - centavos(descuento)) / 100 };
}
