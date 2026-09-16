import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CategoriaProducto from "@/models/CategoriaProducto";
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
    const categoria = await CategoriaProducto.findByIdAndUpdate(id, update, { returnDocument: "after" });
    if (!categoria) return notFound("Categoría no encontrada");
    return NextResponse.json(categoria);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return badRequest("Ya existe una categoría con ese nombre");
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

  const categoria = await CategoriaProducto.findById(id);
  if (!categoria) return notFound("Categoría no encontrada");

  const enUso = await Producto.exists({ categoria: categoria.nombre });
  if (enUso) {
    return conflict("Esta categoría tiene productos asignados; desactívala en lugar de eliminarla");
  }

  await CategoriaProducto.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
