import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Empleado from "@/models/Empleado";
import { requireSession, unauthorized, forbidden, notFound } from "@/lib/apiAuth";
import { normalizarWhatsAppMX } from "@/lib/whatsapp";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  await connectDB();

  const updatable = ["nombre", "puesto", "whatsapp", "activo"];
  const update: Record<string, unknown> = {};
  for (const key of updatable) {
    if (key in body) update[key] = body[key];
  }
  if (update.whatsapp) update.whatsapp = normalizarWhatsAppMX(update.whatsapp as string);

  const empleado = await Empleado.findByIdAndUpdate(id, update, { returnDocument: "after" });
  if (!empleado) return notFound("Empleado no encontrado");

  return NextResponse.json(empleado);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;

  await connectDB();
  const empleado = await Empleado.findByIdAndDelete(id);
  if (!empleado) return notFound("Empleado no encontrado");

  return NextResponse.json({ ok: true });
}
