import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import OrdenCompra from "@/models/OrdenCompra";
import Producto from "@/models/Producto";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, puede } from "@/lib/apiAuth";
import { ErrorRecepcion, validarRecepcion, validarProductosRecepcion } from "@/lib/recepcion";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "matriz" || !puede(usuario, "compras.administrar")) return forbidden();
  try {
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) throw new ErrorRecepcion("Orden inválida");
    const body = await req.json().catch(() => null);
    const entradas = validarRecepcion(body?.items);
    await connectDB();
    const orden = await mongoose.connection.transaction(async (session) => {
      const orden = await OrdenCompra.findById(id).session(session);
      if (!orden) throw new ErrorRecepcion("Orden no encontrada", 404);
      if (orden.estado !== "solicitada") throw new ErrorRecepcion("Esta orden ya no está pendiente de recepción. Actualiza la pantalla.", 409);
      validarProductosRecepcion(entradas, orden.items);
      for (const item of orden.items) {
        const entrada = entradas.find((e) => e.productoId === String(item.productoId))!;
        item.cantidadRecibida = entrada.cantidadRecibida;
        item.notaRecepcion = entrada.notaRecepcion;
        const producto = await Producto.findByIdAndUpdate(item.productoId, {$inc: {existenciaMatriz: entrada.cantidadRecibida}}, {session});
        if (!producto) throw new ErrorRecepcion(`El producto ${item.nombreProducto} ya no existe`);
        if (entrada.cantidadRecibida > 0) await MovimientoInventario.create([{
          tipo: "entrada_proveedor", productoId: item.productoId, nombreProducto: item.nombreProducto,
          ubicacion: "matriz", cantidad: entrada.cantidadRecibida, notaRecepcion: entrada.notaRecepcion,
          ordenCompraId: orden._id, usuarioId: usuario.userId,
        }], {session});
      }
      orden.estado = "recibida";
      orden.fechaRecepcion = new Date();
      orden.recibidoPorId = usuario.userId;
      await orden.save({session});
      return orden;
    });
    return NextResponse.json(orden);
  } catch (error) {
    if (error instanceof ErrorRecepcion) return NextResponse.json({error: error.message}, {status: error.status});
    console.error("Error al recibir orden", error);
    return NextResponse.json({error: "No se guardó la recepción. Intenta nuevamente."}, {status: 500});
  }
}
