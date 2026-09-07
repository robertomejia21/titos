import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import InventarioSucursal from "@/models/InventarioSucursal";
import { cerrarAlertasResurtidas } from "@/lib/alertasInventario";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede, sinPermiso } from "@/lib/apiAuth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pedidos.recibir")) return sinPermiso("pedidos.recibir");
  if (session.role !== "sucursal" || !session.sucursalId) return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const items: { productoId: string; cantidadRecibida: number; pesoRecibidoKg?: number }[] = body?.items ?? [];

  if (items.length === 0) return badRequest("Debes capturar la cantidad recibida de al menos un producto");

  await connectDB();
  const pedido = await Pedido.findById(id);
  if (!pedido) return notFound("Pedido no encontrado");
  if (String(pedido.sucursalId) !== session.sucursalId) return forbidden();

  if (pedido.estado !== "surtido") {
    return badRequest("Sólo se puede registrar la recepción de pedidos que la matriz ya surtió");
  }

  type PedidoItemDoc = (typeof pedido.items)[number];
  const movimientos = [];

  for (const entrada of items) {
    const item = pedido.items.find((i: PedidoItemDoc) => String(i.productoId) === entrada.productoId);
    if (!item) continue;

    const cantidad = Number(entrada.cantidadRecibida);
    if (item.requierePesaje && (!entrada.pesoRecibidoKg || entrada.pesoRecibidoKg <= 0)) {
      return badRequest(`El producto "${item.nombreProducto}" requiere capturar el peso en kg al recibirlo`);
    }

    item.cantidadRecibida = cantidad;
    item.pesoRecibidoKg = entrada.pesoRecibidoKg ?? null;

    await InventarioSucursal.findOneAndUpdate(
      { sucursalId: session.sucursalId, productoId: item.productoId },
      { $inc: { stockActual: cantidad } },
      { upsert: true }
    );

    // Ya llegó: la alerta de agotado que se le mandó a compras se cierra sola.
    if (cantidad > 0) await cerrarAlertasResurtidas(item.productoId, session.sucursalId);

    const movimiento = await MovimientoInventario.create({
      tipo: "entrada_sucursal",
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      ubicacion: session.sucursalId,
      cantidad,
      pesoKg: item.pesoRecibidoKg,
      pedidoId: pedido._id,
      usuarioId: session.userId,
    });
    movimientos.push(movimiento);
  }

  const todosRecibidos = pedido.items.every(
    (i: PedidoItemDoc) => i.cantidadRecibida !== null && i.cantidadRecibida !== undefined
  );
  if (todosRecibidos) {
    pedido.estado = "recibido";
    pedido.recibidoEn = new Date();
    pedido.recibidoPorId = session.userId;
  }

  await pedido.save();

  return NextResponse.json({ pedido, movimientos });
}
