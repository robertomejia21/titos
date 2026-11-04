import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Producto from "@/models/Producto";
import { badRequest, notFound } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";
import { fechaTemporadaValida } from "@/lib/temporadas";
import { listarTemporadas } from "@/lib/temporadasServidor";

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar", "compras.administrar");
  if (error) return error;
  return NextResponse.json(await listarTemporadas());
}

/** Marca un producto como de temporada (con fechas MM-DD) o lo regresa a todo el año. */
export async function PATCH(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar");
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!mongoose.isValidObjectId(body?.productoId)) return badRequest("Producto inválido");
  const producto = await Producto.findById(body.productoId);
  if (!producto) return notFound("Producto no encontrado");

  if (body.activa === false) {
    producto.set("temporada.activa", false);
  } else {
    if (!fechaTemporadaValida(body.inicio) || !fechaTemporadaValida(body.fin)) return badRequest("Captura inicio y fin como MM-DD (por ejemplo 11-15 y 01-06)");
    if (body.inicio === body.fin) return badRequest("El inicio y el fin no pueden ser el mismo día");
    const cambiaInicio = producto.temporada?.inicio !== body.inicio;
    producto.set("temporada", {
      activa: true,
      inicio: body.inicio,
      fin: body.fin,
      // Si cambia la fecha de arranque se vuelve a avisar este año.
      avisadoAnio: cambiaInicio ? 0 : (producto.temporada?.avisadoAnio ?? 0),
    });
  }
  await producto.save();
  return NextResponse.json(await listarTemporadas());
}
