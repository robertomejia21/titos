import Producto from "@/models/Producto";
import MovimientoInventario from "@/models/MovimientoInventario";
import { evaluarPerecedero, gravedad, type EvaluacionPerecedero } from "@/lib/perecederos";

// Arma la evaluación de rotación de todos los perecederos del CEDIS a partir
// de las entradas y salidas registradas (ver lib/perecederos para la regla).

const MS_DIA = 24 * 60 * 60 * 1000;
/** Ventana con la que se calcula la salida diaria promedio. */
export const DIAS_PROMEDIO_SALIDA = 14;

export type RotacionProducto = EvaluacionPerecedero & {
  productoId: string;
  sku: string;
  nombre: string;
  linea: string;
  unidad: string;
  existencia: number;
  vidaUtilDias: number;
};

export async function rotacionPerecederos(ahora = new Date()): Promise<RotacionProducto[]> {
  const productos = await Producto.find({ activo: true, vidaUtilDias: { $gt: 0 }, existenciaMatriz: { $gt: 0 } })
    .select("sku nombre linea unidad existenciaMatriz vidaUtilDias")
    .lean();
  if (!productos.length) return [];

  const ids = productos.map((p) => p._id);
  // Las entradas se buscan hasta 3 vidas útiles atrás (mínimo 30 días): lo que
  // quede más viejo que eso ya es "sin fecha" y se manda a revisar.
  const vidaMaxima = Math.max(...productos.map((p) => p.vidaUtilDias ?? 0));
  const desdeEntradas = new Date(ahora.getTime() - Math.max(30, vidaMaxima * 3) * MS_DIA);
  const desdeSalidas = new Date(ahora.getTime() - DIAS_PROMEDIO_SALIDA * MS_DIA);

  const [entradas, salidas] = await Promise.all([
    MovimientoInventario.find({ productoId: { $in: ids }, ubicacion: "matriz", tipo: "entrada_proveedor", fecha: { $gte: desdeEntradas } })
      .select("productoId cantidad fecha")
      .lean(),
    MovimientoInventario.aggregate([
      { $match: { productoId: { $in: ids }, ubicacion: "matriz", tipo: { $in: ["salida_matriz_a_sucursal", "salida_venta"] }, fecha: { $gte: desdeSalidas } } },
      { $group: { _id: "$productoId", total: { $sum: "$cantidad" } } },
    ]),
  ]);

  const entradasPorProducto = new Map<string, { fecha: Date; cantidad: number }[]>();
  for (const e of entradas) {
    const clave = String(e.productoId);
    entradasPorProducto.set(clave, [...(entradasPorProducto.get(clave) ?? []), { fecha: e.fecha, cantidad: e.cantidad }]);
  }
  const salidaPorProducto = new Map(salidas.map((s: { _id: unknown; total: number }) => [String(s._id), s.total]));

  return productos
    .map((p) => {
      const clave = String(p._id);
      const evaluacion = evaluarPerecedero({
        existencia: p.existenciaMatriz,
        entradas: entradasPorProducto.get(clave) ?? [],
        vidaUtilDias: p.vidaUtilDias,
        salidaDiaria: Math.round(((salidaPorProducto.get(clave) ?? 0) / DIAS_PROMEDIO_SALIDA) * 100) / 100,
        ahora,
      });
      return {
        ...evaluacion,
        productoId: clave,
        sku: p.sku,
        nombre: p.nombre,
        linea: p.linea ?? "",
        unidad: p.unidad,
        existencia: p.existenciaMatriz,
        vidaUtilDias: p.vidaUtilDias,
      };
    })
    .sort((a, b) => gravedad(b.estado) - gravedad(a.estado) || b.excedente - a.excedente || a.nombre.localeCompare(b.nombre));
}
