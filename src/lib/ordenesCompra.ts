import OrdenCompra from "@/models/OrdenCompra";
import Producto from "@/models/Producto";
import ProductoProveedor from "@/models/ProductoProveedor";
import NecesidadCompra from "@/models/NecesidadCompra";
import { generateFolio } from "@/lib/apiAuth";

type OrdenCompraDoc = InstanceType<typeof OrdenCompra>;

export type ItemAAgregar = {
  proveedorId: string;
  productoId: string;
  cantidadOrdenada: number;
  cantidadRequerida?: number | null;
  necesidadId?: string | null;
};

// Agrega un producto a la orden en borrador del proveedor indicado (usa `cache`
// para no volver a buscar/crear la misma orden dos veces dentro de la misma
// petición). Si el proveedor no tiene una orden en borrador, se crea una nueva.
// Si el producto ya está en esa orden, se suma la cantidad en lugar de duplicar
// la línea. No guarda la orden — quien llama debe hacer `await orden.save()`.
export async function agregarItemAOrden(
  cache: Map<string, OrdenCompraDoc>,
  item: ItemAAgregar
): Promise<OrdenCompraDoc> {
  const { proveedorId, productoId, cantidadOrdenada, cantidadRequerida, necesidadId } = item;

  let orden = cache.get(proveedorId);
  if (!orden) {
    orden = (await OrdenCompra.findOne({ proveedorId, estado: "borrador" })) ?? undefined;
    if (!orden) {
      orden = new OrdenCompra({ folio: generateFolio("OC"), proveedorId, estado: "borrador", items: [] });
    }
    cache.set(proveedorId, orden);
  }

  const producto = await Producto.findById(productoId);
  if (!producto) throw new Error(`Producto ${productoId} no encontrado`);

  type OrdenItemDoc = (typeof orden.items)[number];
  const existente = orden.items.find((i: OrdenItemDoc) => String(i.productoId) === String(productoId));

  if (existente) {
    existente.cantidadOrdenada += cantidadOrdenada;
    if (cantidadRequerida != null) {
      existente.cantidadRequerida = (existente.cantidadRequerida ?? 0) + cantidadRequerida;
    }
  } else {
    const costoProveedor = await ProductoProveedor.findOne({ productoId, proveedorId });
    const precioUnitario = costoProveedor?.costoUnitario ?? producto.precioCompra ?? 0;

    orden.items.push({
      productoId,
      nombreProducto: producto.nombre,
      cantidadRequerida: cantidadRequerida ?? null,
      cantidadOrdenada,
      precioUnitario,
      necesidadId: necesidadId ?? null,
    });
  }

  if (necesidadId) {
    await NecesidadCompra.updateOne({ _id: necesidadId }, { estado: "asignada", ordenCompraId: orden._id });
  }

  return orden;
}

type ItemRecibido = {
  productoId: unknown;
  nombreProducto: string;
  cantidadOrdenada: number;
  cantidadRecibida?: number | null;
  precioUnitario?: number | null;
  pedidosOrigen?: unknown[];
};

/**
 * Lo que faltó de cada renglón (ordenado menos recibido; lo rechazado también
 * falta, porque el proveedor lo tiene que reponer). Son los renglones de la
 * orden remanente que queda abierta tras una recepción parcial.
 */
export function itemsRemanentes(items: ItemRecibido[]) {
  return items
    .map((i) => ({ item: i, falta: Math.max(0, i.cantidadOrdenada - (i.cantidadRecibida ?? 0)) }))
    .filter(({ falta }) => falta > 0)
    .map(({ item, falta }) => ({
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      cantidadOrdenada: Math.round(falta * 1000) / 1000,
      precioUnitario: item.precioUnitario ?? 0,
      pedidosOrigen: item.pedidosOrigen ?? [],
    }));
}
