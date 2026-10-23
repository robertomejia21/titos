import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Ruta from "@/models/Ruta";
import { badRequest, notFound } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";
import { datosRuta } from "@/lib/rutasCatalogo";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return badRequest("Ruta inválida");
  const body = await req.json().catch(() => null);
  let datos;
  try {
    datos = datosRuta(body ?? {});
  } catch (e) {
    return badRequest((e as Error).message);
  }
  const ruta = await Ruta.findByIdAndUpdate(id, datos, { returnDocument: "after" });
  if (!ruta) return notFound("Ruta no encontrada");
  return NextResponse.json(ruta);
}
