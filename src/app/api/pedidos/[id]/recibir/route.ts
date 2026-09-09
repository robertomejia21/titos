import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import InventarioSucursal from "@/models/InventarioSucursal";
import AlertaInventarioCero from "@/models/AlertaInventarioCero";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, puede } from "@/lib/apiAuth";
import { ErrorRecepcion, validarRecepcion, validarProductosRecepcion } from "@/lib/recepcion";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "sucursal" || !usuario.sucursalId || !puede(usuario, "pedidos.recibir")) return forbidden();
  try {
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) throw new ErrorRecepcion("Pedido inválido");
    const body = await req.json().catch(() => null);
    const entradas = validarRecepcion(body?.items);
    await connectDB();
    const resultado = await mongoose.connection.transaction(async (session) => {
      const pedido = await Pedido.findById(id).session(session);
      if (!pedido) throw new ErrorRecepcion("Pedido no encontrado", 404);
      if (String(pedido.sucursalId) !== usuario.sucursalId) throw new ErrorRecepcion("Pedido de otra sucursal", 403);
      if (pedido.estado !== "surtido") throw new ErrorRecepcion("Este pedido ya no está pendiente de recepción. Actualiza la pantalla.", 409);
      validarProductosRecepcion(entradas, pedido.items);
      const movimientos = [];
      for (const item of pedido.items) {
        if (item.cantidadRecibida != null) throw new ErrorRecepcion("Este pedido contiene una recepción parcial anterior. Requiere revisión antes de continuar.", 409);
        const entrada = entradas.find((e) => e.productoId === String(item.productoId))!;
        if (item.requierePesaje && entrada.cantidadRecibida > 0 && !(entrada.pesoRecibidoKg! > 0)) throw new ErrorRecepcion(`Captura el peso real de ${item.nombreProducto}`);
        item.cantidadRecibida = entrada.cantidadRecibida;
        item.pesoRecibidoKg = entrada.pesoRecibidoKg ?? null;
        item.notaRecepcion = entrada.notaRecepcion;
        await InventarioSucursal.findOneAndUpdate({sucursalId: usuario.sucursalId, productoId: item.productoId}, {$inc: {stockActual: entrada.cantidadRecibida}}, {upsert: true, session});
        if (entrada.cantidadRecibida > 0) await AlertaInventarioCero.updateOne({productoId: item.productoId, sucursalId: usuario.sucursalId, estado: "abierta"}, {$set: {estado: "atendida", atendidaEn: new Date(), atendidaPorNombre: "Resurtido automático"}}, {session});
        movimientos.push(...await MovimientoInventario.create([{
          tipo: "entrada_sucursal", productoId: item.productoId, nombreProducto: item.nombreProducto,
          ubicacion: usuario.sucursalId, cantidad: entrada.cantidadRecibida, pesoKg: item.pesoRecibidoKg,
          notaRecepcion: entrada.notaRecepcion, pedidoId: pedido._id, usuarioId: usuario.userId,
        }], {session}));
      }
      pedido.estado = "recibido";
      pedido.recibidoEn = new Date();
      pedido.recibidoPorId = usuario.userId;
      await pedido.save({session});
      return {pedido, movimientos};
    });
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof ErrorRecepcion) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error al recibir pedido", error);
    return NextResponse.json({error: "No se guardó la recepción. Intenta nuevamente."}, {status: 500});
  }
}
