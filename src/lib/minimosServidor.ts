import Producto from "@/models/Producto";
import NecesidadCompra from "@/models/NecesidadCompra";
import { obtenerConfiguracionOperacion, hoyCedis } from "@/lib/operacion";
import { cantidadAResurtir, esTemporadaAlta, maximoVigente, minimoVigente } from "@/lib/minimos";

const CAMPOS = "sku nombre linea unidad existenciaMatriz stockMinimo stockMaximo minimoTemporadaAlta piezasPorCaja cajasPorTarima esClave vidaUtilDias";
const TOPE = 6000;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tabla de mínimos con el mínimo vigente de hoy (temporada alta incluida). */
export async function tablaMinimos({ q, soloClave, soloBajo, soloPerecederos }: { q?: string; soloClave?: boolean; soloBajo?: boolean; soloPerecederos?: boolean }) {
  const [config, hoy] = await Promise.all([obtenerConfiguracionOperacion(), hoyCedis()]);
  const filtro: Record<string, unknown> = { activo: true };
  if (soloClave) filtro.esClave = true;
  if (soloPerecederos) filtro.vidaUtilDias = { $gt: 0 };
  if (q) {
    const regex = new RegExp(escapeRegExp(q), "i");
    filtro.$or = [{ nombre: regex }, { sku: regex }, { linea: regex }];
  }
  const productos = await Producto.find(filtro).select(CAMPOS).sort({ esClave: -1, nombre: 1 }).limit(TOPE).lean();
  const pendientes = new Set(
    (await NecesidadCompra.find({ estado: "pendiente", productoId: { $in: productos.map((p) => p._id) } }).select("productoId").lean()).map((n) =>
      String(n.productoId)
    )
  );
  const items = productos
    .map((p) => {
      const minimo = minimoVigente(p, hoy, config.temporadaAlta);
      const maximo = maximoVigente(p, hoy, config.temporadaAlta);
      const bajoMinimo = minimo > 0 && p.existenciaMatriz <= minimo;
      return {
        _id: String(p._id),
        sku: p.sku,
        nombre: p.nombre,
        linea: p.linea ?? "",
        unidad: p.unidad,
        existenciaMatriz: p.existenciaMatriz,
        stockMinimo: p.stockMinimo ?? 0,
        stockMaximo: p.stockMaximo ?? 0,
        minimoTemporadaAlta: p.minimoTemporadaAlta ?? 0,
        piezasPorCaja: p.piezasPorCaja ?? 0,
        cajasPorTarima: p.cajasPorTarima ?? 0,
        esClave: !!p.esClave,
        vidaUtilDias: p.vidaUtilDias ?? 0,
        minimoVigente: minimo,
        maximoVigente: maximo,
        bajoMinimo,
        aResurtir: bajoMinimo ? cantidadAResurtir(p.existenciaMatriz, minimo, maximo, p) : 0,
        necesidadPendiente: pendientes.has(String(p._id)),
      };
    })
    .filter((p) => !soloBajo || p.bajoMinimo);
  return { fecha: hoy, temporadaAlta: esTemporadaAlta(hoy, config.temporadaAlta), items, truncado: productos.length >= TOPE };
}

/**
 * Manda a "Necesidades por ordenar" lo que quedó bajo mínimo, con la cantidad
 * para volver al máximo en cajas completas. No duplica un producto que ya
 * tiene una necesidad pendiente.
 */
export async function generarNecesidadesBajoMinimo(productoIds?: string[]) {
  const { items } = await tablaMinimos({ soloBajo: true });
  const candidatos = items.filter((p) => !p.necesidadPendiente && p.aResurtir > 0 && (!productoIds?.length || productoIds.includes(p._id)));
  if (!candidatos.length) return [];
  return NecesidadCompra.insertMany(
    candidatos.map((p) => ({ productoId: p._id, nombreProducto: p.nombre, cantidadRequerida: p.aResurtir, motivo: "bajo_minimo" }))
  );
}
