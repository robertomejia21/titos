import AlertaInventarioCero from "@/models/AlertaInventarioCero";
import NecesidadCompra from "@/models/NecesidadCompra";
import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { enviarWhatsApp } from "@/lib/evolutionApi";
import type { ContextoPuntoVenta } from "@/lib/puntoVenta";

// Aviso al área de compras cuando una venta deja un producto en cero.
//
// El punto de venta cobra aunque el sistema no tenga existencia (el producto
// está en el mostrador y el cliente lo tiene en la mano), así que aquí caen dos
// casos: el producto que se acaba de agotar y el que ya venía descuadrado y se
// vendió en negativo. Los dos necesitan resurtido y compras tiene que enterarse
// el mismo día; el segundo necesita además un ajuste de inventario.
//
// Además del WhatsApp, el producto entra a las "necesidades por ordenar" que ya
// alimentan las órdenes de compra, para que el aviso no dependa de que alguien
// lea el mensaje.
//
// Nada de esto puede tumbar una venta: se llama después de que la venta ya está
// guardada y todo va dentro de un try/catch.

export type ProductoAgotado = {
  productoId: unknown;
  sku: string;
  nombreProducto: string;
  unidad: string;
  cantidadVendida: number;
  stockResultante: number;
  /** true cuando se cobró más de lo que el sistema tenía registrado. */
  vendidoSinExistencia?: boolean;
};

/** Cuánto sugerir comprar: lo que falte para el máximo, o el mínimo, o una pieza. */
function cantidadSugerida(producto: { stockMaximo?: number; stockMinimo?: number } | null) {
  return Math.max(1, producto?.stockMaximo ?? 0, producto?.stockMinimo ?? 0);
}

/**
 * Registra las alertas de los productos que quedaron en cero y manda un solo
 * WhatsApp con todos. Devuelve cuántas alertas nuevas se abrieron.
 */
export async function alertarInventarioEnCero({
  ctx,
  agotados,
  ventaId = null,
  ventaFolio = "",
}: {
  ctx: ContextoPuntoVenta;
  agotados: ProductoAgotado[];
  ventaId?: unknown;
  ventaFolio?: string;
}): Promise<number> {
  if (agotados.length === 0) return 0;

  const config = await obtenerConfiguracion();
  if (config.alertas?.inventarioCeroActiva === false) return 0;

  const sucursal = await Sucursal.findById(ctx.sucursalId).select("nombre").lean();
  const sucursalNombre = (sucursal as { nombre?: string } | null)?.nombre ?? "";

  // Solo se avisa de las que se abren ahora: mientras el producto siga agotado
  // su alerta continúa abierta y no vuelve a mandar mensaje.
  const nuevas: ProductoAgotado[] = [];
  const idsNuevas: unknown[] = [];

  for (const item of agotados) {
    const yaAbierta = await AlertaInventarioCero.findOne({
      productoId: item.productoId,
      sucursalId: ctx.sucursalId,
      estado: "abierta",
    })
      .select("_id")
      .lean();
    if (yaAbierta) continue;

    let creada;
    try {
      creada = await AlertaInventarioCero.create({
        productoId: item.productoId,
        sku: item.sku,
        nombreProducto: item.nombreProducto,
        unidad: item.unidad,
        sucursalId: ctx.sucursalId,
        sucursalNombre,
        esMatriz: ctx.esMatriz,
        ventaId,
        ventaFolio,
        cantidadVendida: item.cantidadVendida,
        stockResultante: item.stockResultante,
        vendidoSinExistencia: !!item.vendidoSinExistencia,
        fecha: new Date(),
        estado: "abierta",
      });
    } catch (err) {
      // Dos cajas vendiendo la última pieza del mismo producto a la vez: el
      // índice único deja pasar una sola alerta, y que la otra se caiga aquí es
      // justo lo que se quiere.
      if ((err as { code?: number }).code === 11000) continue;
      throw err;
    }

    nuevas.push(item);
    idsNuevas.push(creada._id);
  }

  if (nuevas.length === 0) return 0;

  // El producto también entra a la lista de necesidades por ordenar, que es de
  // donde salen las órdenes de compra. Si ya estaba pendiente no se duplica.
  for (const item of nuevas) {
    const yaPendiente = await NecesidadCompra.findOne({
      productoId: item.productoId,
      estado: "pendiente",
    })
      .select("_id")
      .lean();
    if (yaPendiente) continue;

    const producto = await Producto.findById(item.productoId).select("stockMinimo stockMaximo").lean();
    await NecesidadCompra.create({
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      cantidadRequerida: cantidadSugerida(producto as { stockMaximo?: number; stockMinimo?: number } | null),
      motivo: "agotado_venta",
      estado: "pendiente",
    });
  }

  await notificarCompras({
    destinatarios: (config.alertas?.destinatariosCompras ?? []).filter((d: string) => d.trim()),
    sucursalNombre,
    ventaFolio,
    agotados: nuevas,
    idsAlerta: idsNuevas,
  });

  return nuevas.length;
}

/** Un solo mensaje con todos los productos que se agotaron en esta venta. */
async function notificarCompras({
  destinatarios,
  sucursalNombre,
  ventaFolio,
  agotados,
  idsAlerta,
}: {
  destinatarios: string[];
  sucursalNombre: string;
  ventaFolio: string;
  agotados: ProductoAgotado[];
  /**
   * Las alertas recién creadas, por id. Se marcan por id y no por producto: el
   * mismo producto puede estar agotado en otra tienda con su propia alerta
   * abierta, y ese aviso no se mandó en este mensaje.
   */
  idsAlerta: unknown[];
}) {
  const marcar = (notificada: boolean, error: string) =>
    AlertaInventarioCero.updateMany(
      { _id: { $in: idsAlerta } },
      { $set: { notificada, errorNotificacion: error } }
    );

  if (destinatarios.length === 0) {
    // Sin WhatsApp capturado la alerta no se pierde: sigue abierta y visible en
    // el tablero de matriz, que es donde compras la ve de todos modos.
    await marcar(false, "No hay WhatsApp de compras configurado");
    return;
  }

  const hayDescuadre = agotados.some((a) => a.vendidoSinExistencia);

  const mensaje = [
    hayDescuadre ? "Producto agotado (y vendido sin existencia)" : "Producto agotado en piso",
    "",
    `${sucursalNombre || "Una tienda"} se quedó sin existencia${ventaFolio ? ` (venta ${ventaFolio})` : ""}:`,
    ...agotados.map((a) => {
      const nombre = `${a.nombreProducto}${a.sku ? ` (${a.sku})` : ""}`;
      // El renglón dice cuánto quedó en rojo: es el ajuste que hay que hacer.
      return a.vendidoSinExistencia
        ? `• ${nombre} — se vendió sin existencia, el sistema quedó en ${a.stockResultante}`
        : `• ${nombre} — quedó en 0`;
    }),
    "",
    hayDescuadre
      ? "Ya quedaron en las necesidades por ordenar. Los marcados en negativo necesitan además un ajuste de inventario."
      : "Ya quedaron en las necesidades por ordenar del sistema.",
  ].join("\n");

  // Se intenta con todos los destinatarios y hasta el final se marca una sola
  // vez: que a un número le llegue y a otro no, no es motivo para repetir el
  // aviso completo en el siguiente agotado.
  let algunoLlego = false;
  const errores: string[] = [];

  for (const numero of destinatarios) {
    try {
      await enviarWhatsApp(numero, mensaje);
      algunoLlego = true;
    } catch (err) {
      errores.push((err as Error).message);
    }
  }

  await marcar(algunoLlego, algunoLlego ? "" : errores.join(" · "));
}

/**
 * Cierra las alertas abiertas de un producto en cuanto vuelve a haber
 * existencia. Sin esto, el producto se resurte y la alerta se queda colgada en
 * el tablero pidiendo lo que ya llegó.
 */
export async function cerrarAlertasResurtidas(productoId: unknown, sucursalId: unknown) {
  await AlertaInventarioCero.updateOne(
    { productoId, sucursalId, estado: "abierta" },
    {
      $set: {
        estado: "atendida",
        atendidaEn: new Date(),
        atendidaPorNombre: "Resurtido automático",
      },
    }
  );
}
