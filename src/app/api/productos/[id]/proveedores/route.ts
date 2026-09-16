import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import ProductoProveedor from "@/models/ProductoProveedor";
import Producto from "@/models/Producto";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;

  await connectDB();
  const enlaces = await ProductoProveedor.find({ productoId: id })
    .populate("proveedorId", "nombre")
    .sort({ costoUnitario: 1 })
    .lean();

  return NextResponse.json(enlaces);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.proveedorId) {
    return badRequest("El proveedor es requerido");
  }

  await connectDB();

  const producto = await Producto.findById(id);
  if (!producto) return notFound("Producto no encontrado");

  const costo = Number(body.costo) || 0;
  const ivaPct = Number(body.ivaPct) || 0;
  const iepsPct = Number(body.iepsPct) || 0;
  const costoUnitario = costo + costo * ((ivaPct + iepsPct) / 100);

  const enlace = await ProductoProveedor.findOneAndUpdate(
    { productoId: id, proveedorId: body.proveedorId },
    {
      costo,
      ivaPct,
      iepsPct,
      costoUnitario,
      esPrincipal: Boolean(body.esPrincipal),
      activo: true,
    },
    { returnDocument: "after", upsert: true }
  ).populate("proveedorId", "nombre");

  return NextResponse.json(enlace, { status: 201 });
}
