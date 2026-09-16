import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Proveedor from "@/models/Proveedor";
import OrdenCompra from "@/models/OrdenCompra";
import { requireSession, unauthorized, forbidden, notFound, conflict } from "@/lib/apiAuth";
import { normalizarWhatsAppMX } from "@/lib/whatsapp";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  await connectDB();

  const updatable = ["nombre", "contacto", "whatsapp", "email", "activo"];
  const update: Record<string, unknown> = {};
  for (const key of updatable) {
    if (key in body) update[key] = body[key];
  }
  if (update.whatsapp) update.whatsapp = normalizarWhatsAppMX(update.whatsapp as string);

  const proveedor = await Proveedor.findByIdAndUpdate(id, update, { returnDocument: "after" });
  if (!proveedor) return notFound("Proveedor no encontrado");

  return NextResponse.json(proveedor);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;

  await connectDB();

  const tieneOrdenes = await OrdenCompra.exists({ proveedorId: id });
  if (tieneOrdenes) {
    return conflict("Este proveedor tiene órdenes de compra registradas; desactívalo en lugar de eliminarlo");
  }

  const proveedor = await Proveedor.findByIdAndDelete(id);
  if (!proveedor) return notFound("Proveedor no encontrado");

  return NextResponse.json({ ok: true });
}
