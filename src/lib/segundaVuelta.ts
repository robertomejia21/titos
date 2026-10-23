import mongoose from "mongoose";
import Pedido from "@/models/Pedido";
import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";
import { prorratear, type CriterioProrrateo } from "@/lib/prorrateo";
import { mapaPrioridades, obtenerConfiguracionOperacion } from "@/lib/operacion";

// Segunda vuelta: lo que no alcanzó en la primera se completa después, en un
// pedido complemento (vuelta 2) ligado al original. El original no se toca:
// sigue siendo la referencia de lo que la tienda pidió, y cada renglón lleva la
// cuenta de cuánto ya se le complementó.

const MS_DIA = 24 * 60 * 60 * 1000;

type ItemFaltante = {
  cantidadPedida: number;
  cantidadAsignada?: number | null;
  cantidadSurtida?: number | null;
  cantidadComplementada?: number | null;
};

/** Lo que todavía le falta a un renglón: lo pedido menos lo surtido (o asignado) menos lo ya complementado. */
export function faltanteDe(item: ItemFaltante) {
  const mandado = item.cantidadSurtida ?? item.cantidadAsignada ?? 0;
  return Math.max(0, Math.round((item.cantidadPedida - mandado - (item.cantidadComplementada ?? 0)) * 1000) / 1000);
}

function filtroVigentes(diasVigencia: number, ahora = new Date()) {
  return {
    vuelta: { $ne: 2 },
    estado: { $in: ["nivelado", "surtido", "recibido"] },
    fecha: { $gte: new Date(ahora.getTime() - diasVigencia * MS_DIA) },
  };
}

export type PedidoConFaltante = {
  _id: string;
  folio: string;
  sucursalId: string;
  sucursalNombre: string;
  estado: string;
  fecha: Date;
  items: { productoId: string; nombreProducto: string; unidad: string; cantidadPedida: number; mandado: number; complementado: number; faltante: number; existenciaMatriz: number }[];
};

/** Pedidos de los últimos días a los que todavía les falta algo, con la existencia actual de cada producto. */
export async function pedidosConFaltante(): Promise<PedidoConFaltante[]> {
  const config = await obtenerConfiguracionOperacion();
  const pedidos = await Pedido.find(filtroVigentes(config.segundaVuelta?.diasVigencia ?? 3)).sort({ fecha: 1 }).lean();
  const conFaltante = pedidos.filter((p) => p.items.some((i: ItemFaltante) => faltanteDe(i) > 0));
  const productoIds = [...new Set(conFaltante.flatMap((p) => p.items.map((i: { productoId: unknown }) => String(i.productoId))))];
  const [productos, sucursales] = await Promise.all([
    Producto.find({ _id: { $in: productoIds } }).select("existenciaMatriz").lean(),
    Sucursal.find({ _id: { $in: conFaltante.map((p) => p.sucursalId) } }).select("nombre").lean(),
  ]);
  const existencia = new Map(productos.map((p) => [String(p._id), p.existenciaMatriz ?? 0]));
  const nombre = new Map(sucursales.map((s) => [String(s._id), s.nombre]));
  return conFaltante.map((p) => ({
    _id: String(p._id),
    folio: p.folio,
    sucursalId: String(p.sucursalId),
    sucursalNombre: nombre.get(String(p.sucursalId)) ?? "Sucursal",
    estado: p.estado,
    fecha: p.fecha,
    items: p.items
      .filter((i: ItemFaltante) => faltanteDe(i) > 0)
      .map((i: ItemFaltante & { productoId: unknown; nombreProducto: string; unidad: string }) => ({
        productoId: String(i.productoId),
        nombreProducto: i.nombreProducto,
        unidad: i.unidad,
        cantidadPedida: i.cantidadPedida,
        mandado: i.cantidadSurtida ?? i.cantidadAsignada ?? 0,
        complementado: i.cantidadComplementada ?? 0,
        faltante: faltanteDe(i),
        existenciaMatriz: existencia.get(String(i.productoId)) ?? 0,
      })),
  }));
}

export type ResultadoSegundaVuelta = {
  complementos: { folio: string; pedidoOrigen: string; sucursalNombre: string; renglones: number; nuevo: boolean }[];
  /** Productos con faltante que siguen sin existencia en el CEDIS. */
  sinExistencia: string[];
};

/**
 * Arma (o amplía) los pedidos complemento con la existencia actual del CEDIS.
 * La escasez se reparte con el mismo criterio de prorrateo que el Nivelador.
 *
 * Si ya hay un complemento del mismo pedido que todavía no se surte, se le
 * suman los renglones en vez de abrir otro: al chofer le llega un solo folio
 * por tienda y vuelta.
 */
export async function generarSegundaVuelta({ productoIds, pedidoIds }: { productoIds?: string[]; pedidoIds?: string[] } = {}): Promise<ResultadoSegundaVuelta> {
  const config = await obtenerConfiguracionOperacion();
  const criterio = (config.criterioProrrateo ?? "caja_completa") as CriterioProrrateo;
  const prioridades = mapaPrioridades(config);
  const filtro: Record<string, unknown> = filtroVigentes(config.segundaVuelta?.diasVigencia ?? 3);
  if (pedidoIds?.length) filtro._id = { $in: pedidoIds };
  if (productoIds?.length) filtro["items.productoId"] = { $in: productoIds };

  return mongoose.connection.transaction(async (session) => {
    const resultado: ResultadoSegundaVuelta = { complementos: [], sinExistencia: [] };
    const pedidos = await Pedido.find(filtro).sort({ fecha: 1 }).session(session);

    type Renglon = { pedido: (typeof pedidos)[number]; itemIndex: number; faltante: number };
    const porProducto = new Map<string, Renglon[]>();
    for (const pedido of pedidos) {
      pedido.items.forEach((item: ItemFaltante & { productoId: unknown }, itemIndex: number) => {
        const clave = String(item.productoId);
        if (productoIds?.length && !productoIds.includes(clave)) return;
        const faltante = faltanteDe(item);
        if (faltante <= 0) return;
        porProducto.set(clave, [...(porProducto.get(clave) ?? []), { pedido, itemIndex, faltante }]);
      });
    }

    // pedidoOrigenId → renglones a mandar en su complemento
    const aComplementar = new Map<string, { pedido: (typeof pedidos)[number]; renglones: { itemIndex: number; cantidad: number }[] }>();

    for (const [productoId, renglones] of porProducto) {
      const producto = await Producto.findById(productoId).session(session);
      if (!producto) continue;
      if ((producto.existenciaMatriz ?? 0) <= 0) {
        resultado.sinExistencia.push(producto.nombre);
        continue;
      }
      const demandaPorSucursal = new Map<string, number>();
      for (const r of renglones) {
        const s = String(r.pedido.sucursalId);
        demandaPorSucursal.set(s, (demandaPorSucursal.get(s) ?? 0) + r.faltante);
      }
      const asignaciones = prorratear(
        producto.existenciaMatriz,
        [...demandaPorSucursal].map(([sucursalId, cantidad]) => ({ sucursalId, cantidad, prioridad: prioridades.get(sucursalId) })),
        { criterio, piezasPorCaja: producto.piezasPorCaja ?? 0 }
      );
      const restante = new Map(asignaciones.map((a) => [a.sucursalId, a.cantidadAsignada]));
      let total = 0;
      for (const r of renglones) {
        const s = String(r.pedido.sucursalId);
        const dar = Math.min(restante.get(s) ?? 0, r.faltante);
        if (dar <= 0) continue;
        restante.set(s, (restante.get(s) ?? 0) - dar);
        total += dar;
        const clave = String(r.pedido._id);
        const entrada = aComplementar.get(clave) ?? { pedido: r.pedido, renglones: [] };
        entrada.renglones.push({ itemIndex: r.itemIndex, cantidad: dar });
        aComplementar.set(clave, entrada);
      }
      producto.existenciaMatriz -= total;
      await producto.save({ session });
    }

    const sucursales = await Sucursal.find({ _id: { $in: [...aComplementar.values()].map((e) => e.pedido.sucursalId) } }).select("nombre").session(session).lean();
    const nombre = new Map(sucursales.map((s) => [String(s._id), s.nombre]));
    const ahora = new Date();

    for (const { pedido, renglones } of aComplementar.values()) {
      const nuevosItems = renglones.map(({ itemIndex, cantidad }) => {
        const item = pedido.items[itemIndex];
        item.cantidadComplementada = (item.cantidadComplementada ?? 0) + cantidad;
        return {
          productoId: item.productoId,
          nombreProducto: item.nombreProducto,
          categoria: item.categoria,
          unidad: item.unidad,
          requierePesaje: item.requierePesaje,
          precioVenta: item.precioVenta,
          cantidadPedida: cantidad,
          cantidadAsignada: cantidad,
        };
      });
      await pedido.save({ session });

      const abierto = await Pedido.findOne({ pedidoOrigenId: pedido._id, estado: "nivelado" }).session(session);
      if (abierto) {
        for (const nuevo of nuevosItems) {
          const existente = abierto.items.find((i: { productoId: unknown }) => String(i.productoId) === String(nuevo.productoId));
          if (existente) {
            existente.cantidadPedida += nuevo.cantidadPedida;
            existente.cantidadAsignada = (existente.cantidadAsignada ?? 0) + nuevo.cantidadAsignada;
          } else abierto.items.push(nuevo);
        }
        await abierto.save({ session });
        resultado.complementos.push({ folio: abierto.folio, pedidoOrigen: pedido.folio, sucursalNombre: nombre.get(String(pedido.sucursalId)) ?? "", renglones: nuevosItems.length, nuevo: false });
        continue;
      }

      const previos = await Pedido.countDocuments({ pedidoOrigenId: pedido._id }).session(session);
      const folio = `${pedido.folio}-V2${previos ? `-${previos + 1}` : ""}`;
      await Pedido.create(
        [
          {
            folio,
            sucursalId: pedido.sucursalId,
            fecha: ahora,
            corte: pedido.corte,
            estado: "nivelado",
            niveladoEn: ahora,
            vuelta: 2,
            pedidoOrigenId: pedido._id,
            repartidorId: null,
            items: nuevosItems,
          },
        ],
        { session }
      );
      resultado.complementos.push({ folio, pedidoOrigen: pedido.folio, sucursalNombre: nombre.get(String(pedido.sucursalId)) ?? "", renglones: nuevosItems.length, nuevo: true });
    }

    return resultado;
  });
}
