import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";
import type { BorradorPromocion } from "./promociones";

export async function validarSeleccionPromocion(p: BorradorPromocion) {
  const [sucursales, productos, categorias] = await Promise.all([
    Sucursal.countDocuments({ _id: { $in: p.sucursales }, activo: true }),
    p.alcance === "productos" ? Producto.countDocuments({ _id: { $in: p.productos }, activo: true, ...(p.unidad !== "todas" ? { unidad: p.unidad } : {}) }) : 0,
    p.alcance === "categorias" ? Producto.distinct("categoria", { activo: true, ...(p.unidad !== "todas" ? { unidad: p.unidad } : {}) }) : [],
  ]);
  if (sucursales !== p.sucursales.length) throw new Error("Alguna sucursal ya no está activa. Revisa la selección.");
  if (p.alcance === "productos" && productos !== p.productos.length) throw new Error("Algún producto ya no está activo o no corresponde a la unidad elegida.");
  if (p.alcance === "categorias" && p.categorias.some((c) => !new Set<string>(categorias).has(c))) throw new Error("Alguna categoría no tiene productos activos con la unidad elegida.");
}
