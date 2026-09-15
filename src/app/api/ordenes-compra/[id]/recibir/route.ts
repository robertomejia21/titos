import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import OrdenCompra from "@/models/OrdenCompra";
import Producto from "@/models/Producto";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, puede } from "@/lib/apiAuth";
import { ErrorRecepcion, validarRecepcion, validarProductosRecepcion } from "@/lib/recepcion";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { validarReglasOperacion } from "@/lib/reglasOperacion";
import { costoRecepcion, type DetalleCostoRecepcion } from "@/lib/costosRecepcion";
import FolioSecuencia from "@/models/FolioSecuencia";
import { obtenerMostradorMatriz } from "@/lib/puntoVenta";

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
    const reglas = validarReglasOperacion((await obtenerConfiguracion()).reglasOperacion);
    const financiero = body?.financiero;
    const sucursal = financiero ? await obtenerMostradorMatriz() : null;
    if (financiero) {
      if (!["MXN","USD"].includes(financiero.moneda) || typeof financiero.tipoCambio !== "number" || !Number.isFinite(financiero.tipoCambio) || financiero.tipoCambio<=0) throw new ErrorRecepcion("Revisa moneda y tipo de cambio del proveedor.");
      if (![financiero.servicio,financiero.descuento].every(v=>typeof v === "number" && Number.isFinite(v) && v>=0 && v<=1e9)) throw new ErrorRecepcion("Servicio y descuento deben ser importes válidos.");
      if (typeof financiero.observaciones !== "string" || financiero.observaciones.length>2000) throw new ErrorRecepcion("Las observaciones admiten hasta 2,000 caracteres.");
    }
    const orden = await mongoose.connection.transaction(async (session) => {
      const orden = await OrdenCompra.findById(id).session(session);
      if (!orden) throw new ErrorRecepcion("Orden no encontrada", 404);
      if (orden.estado !== "solicitada") throw new ErrorRecepcion("Esta orden ya no está pendiente de recepción. Actualiza la pantalla.", 409);
      validarProductosRecepcion(entradas, orden.items);
      const detalle: DetalleCostoRecepcion[] = [];
      for (const item of orden.items) {
        const entrada = entradas.find((e) => e.productoId === String(item.productoId))!;
        item.cantidadRecibida = entrada.cantidadRecibida;
        item.notaRecepcion = entrada.notaRecepcion;
        const producto = await Producto.findByIdAndUpdate(item.productoId, {$inc: {existenciaMatriz: entrada.cantidadRecibida}}, {session});
        if (!producto) throw new ErrorRecepcion(`El producto ${item.nombreProducto} ya no existe`);
        if (financiero) {
          const costo = body.items.find((i: {productoId: string})=>i.productoId===String(item.productoId))?.costoUnitario;
          if (typeof costo !== "number") throw new ErrorRecepcion("Captura el costo de todos los productos.");
          try {
            detalle.push({productoId: String(item.productoId), nombre: item.nombreProducto, sku: producto.sku, unidad: producto.unidad, cantidad: entrada.cantidadRecibida, costo, fiscal: producto.fiscal, ...costoRecepcion(entrada.cantidadRecibida,costo,producto.fiscal,reglas)});
          } catch(error) { throw new ErrorRecepcion(`${item.nombreProducto}: ${(error as Error).message}`); }
        }
        if (entrada.cantidadRecibida > 0) await MovimientoInventario.create([{
          tipo: "entrada_proveedor", productoId: item.productoId, nombreProducto: item.nombreProducto,
          ubicacion: "matriz", cantidad: entrada.cantidadRecibida, notaRecepcion: entrada.notaRecepcion,
          ordenCompraId: orden._id, usuarioId: usuario.userId,
        }], {session});
      }
      orden.estado = "recibida";
      orden.fechaRecepcion = new Date();
      orden.recibidoPorId = usuario.userId;
      if (financiero) {
        const suma = (key: "subtotal"|"iva"|"ieps"|"total")=>detalle.reduce((s,i)=>s+Math.round(i[key]*100),0)/100;
        const total = Math.round((suma("total")+financiero.servicio-financiero.descuento)*100)/100;
        if (total<0) throw new ErrorRecepcion("El descuento no puede superar el importe de la recepción.");
        const secuencia = await FolioSecuencia.findOneAndUpdate({prefijo:`REC-${sucursal!._id}`},{$inc:{consecutivo:1}},{session,upsert:true,returnDocument:"after"});
        orden.recepcionCostos = {...financiero, folio:String(secuencia.consecutivo).padStart(6,"0"),sucursalId:String(sucursal!._id),sucursalNombre:sucursal!.nombre, tipoCambio: financiero.moneda === "MXN" ? 1 : financiero.tipoCambio, reglas, detalle, subtotal:suma("subtotal"),iva:suma("iva"),ieps:suma("ieps"),total};
      }
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
