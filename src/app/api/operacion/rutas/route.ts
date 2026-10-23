import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Ruta from "@/models/Ruta";
import { datosRuta } from "@/lib/rutasCatalogo";
import { badRequest } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  return NextResponse.json(await Ruta.find().sort({ activo: -1, horaSalida: 1, orden: 1 }).lean());
}

export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await Ruta.create(datosRuta(body ?? {})), { status: 201 });
  } catch (e) {
    if (e instanceof mongoose.Error) throw e;
    return badRequest((e as Error).message);
  }
}
