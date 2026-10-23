import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Vehiculo from "@/models/Vehiculo";
import { badRequest, notFound } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";
import { datosVehiculo } from "@/lib/rutasCatalogo";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return badRequest("Unidad inválida");
  const body = await req.json().catch(() => null);
  let datos;
  try {
    datos = datosVehiculo(body ?? {});
  } catch (e) {
    return badRequest((e as Error).message);
  }
  const vehiculo = await Vehiculo.findByIdAndUpdate(id, datos, { returnDocument: "after" });
  if (!vehiculo) return notFound("Unidad no encontrada");
  return NextResponse.json(vehiculo);
}
