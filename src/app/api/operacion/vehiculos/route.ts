import { NextRequest, NextResponse } from "next/server";
import Vehiculo from "@/models/Vehiculo";
import { datosVehiculo } from "@/lib/rutasCatalogo";
import { badRequest } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  return NextResponse.json(await Vehiculo.find().sort({ activo: -1, nombre: 1 }).lean());
}

export async function POST(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await Vehiculo.create(datosVehiculo(body ?? {})), { status: 201 });
  } catch (e) {
    return badRequest((e as Error).message);
  }
}
