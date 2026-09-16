import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import LineaProducto from "@/models/LineaProducto";
import Producto from "@/models/Producto";
import { requireSession, unauthorized, forbidden, notFound, conflict, badRequest } from "@/lib/apiAuth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  await connectDB();

  const updatable = ["nombre", "activo"];
  const update: Record<string, unknown> = {};
  for (const key of updatable) {
    if (key in body) update[key] = body[key];
  }

  try {
    const linea = await LineaProducto.findByIdAndUpdate(id, update, { returnDocument: "after" });
    if (!linea) return notFound("Línea no encontrada");
    return NextResponse.json(linea);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return badRequest("Ya existe una línea con ese nombre");
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;

  await connectDB();

  const linea = await LineaProducto.findById(id);
  if (!linea) return notFound("Línea no encontrada");

  const enUso = await Producto.exists({ linea: linea.nombre });
  if (enUso) {
    return conflict("Esta línea tiene productos asignados; desactívala en lugar de eliminarla");
  }

  await LineaProducto.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
