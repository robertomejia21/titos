import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede, sinPermiso } from "@/lib/apiAuth";
import { evento } from "@/lib/logistica";
import { respuestaPedido } from "@/lib/cajasPedido";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pedidos.surtir")) return sinPermiso("pedidos.surtir");
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const items: { productoId: string; cantidadSurtida: number; pesoSurtidoKg?: number }[] = body?.items ?? [];

  if (items.length === 0) return badRequest("Debes capturar la cantidad surtida de al menos un producto");

  await connectDB();
  const pedido = await Pedido.findById(id);
  if (!pedido) return notFound("Pedido no encontrado");

  if (pedido.estado !== "nivelado") {
    return badRequest("Sólo se pueden surtir pedidos que ya pasaron por el Nivelador (estado 'nivelado')");
  }

  type PedidoItemDoc = (typeof pedido.items)[number];
  const movimientos = [];

  for (const entrada of items) {
    const item = pedido.items.find((i: PedidoItemDoc) => String(i.productoId) === entrada.productoId);
    if (!item) continue;

    const cantidad = Number(entrada.cantidadSurtida);
    if (item.requierePesaje && (!entrada.pesoSurtidoKg || entrada.pesoSurtidoKg <= 0)) {
      return badRequest(`El producto "${item.nombreProducto}" requiere capturar el peso en kg al surtir`);
    }

    item.cantidadSurtida = cantidad;
    item.pesoSurtidoKg = entrada.pesoSurtidoKg ?? null;

    const movimiento = await MovimientoInventario.create({
      tipo: "salida_matriz_a_sucursal",
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      ubicacion: "matriz",
      cantidad,
      pesoKg: item.pesoSurtidoKg,
      pedidoId: pedido._id,
      usuarioId: session.userId,
    });
    movimientos.push(movimiento);
  }

  const todosSurtidos = pedido.items.every(
    (i: PedidoItemDoc) => i.cantidadSurtida !== null && i.cantidadSurtida !== undefined
  );
  if (todosSurtidos) {
    pedido.estado = "surtido";
    // Se sella al quedar completo: es el momento desde el que corre el plazo de
    // recepción y lo que la bitácora reporta como "quién surtió".
    pedido.surtidoEn = new Date();
    pedido.surtidoPorId = session.userId;
    pedido.historial.push(evento(session, "surtido"));
  }

  await pedido.save();

  // Poblado y sin montos si no se pueden ver: es lo que vuelve a pintar el detalle.
  return NextResponse.json({ pedido: await respuestaPedido(pedido._id, session), movimientos });
}
