import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import "@/models/Sucursal"; // necesario para que populate("sucursalId") funcione
import "@/models/Empleado"; // necesario para que populate("repartidorId") funcione
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const { id } = await params;
  await connectDB();

  const pedido = await Pedido.findById(id)
    .populate("sucursalId", "nombre whatsapp")
    .populate("repartidorId", "nombre whatsapp puesto")
    .lean();
  if (!pedido) return notFound("Pedido no encontrado");

  if (session.role === "sucursal" && String(pedido.sucursalId?._id ?? pedido.sucursalId) !== session.sucursalId) {
    return forbidden();
  }

  return NextResponse.json(pedido);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !("repartidorId" in body)) return badRequest("No hay cambios para aplicar");

  await connectDB();
  const pedido = await Pedido.findByIdAndUpdate(
    id,
    { repartidorId: body.repartidorId || null },
    { returnDocument: "after" }
  )
    .populate("sucursalId", "nombre whatsapp")
    .populate("repartidorId", "nombre whatsapp puesto");
  if (!pedido) return notFound("Pedido no encontrado");

  return NextResponse.json(pedido);
}
