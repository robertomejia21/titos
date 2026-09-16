import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, puede, badRequest, conflict, notFound } from "@/lib/apiAuth";
import Departamento from "@/models/Departamento";
import Rol from "@/models/Rol";
import { claveDepartamento } from "@/lib/departamentos";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "usuarios.administrar")) return forbidden();
  const { id } = await params;
  if (!isValidObjectId(id)) return badRequest("Departamento inválido.");
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Datos inválidos.");
  await connectDB();
  const departamento = await Departamento.findById(id);
  if (!departamento) return notFound("Departamento no encontrado.");
  if ("nombre" in body) {
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre || nombre.length > 80) return badRequest("El nombre debe tener entre 1 y 80 caracteres.");
    departamento.nombre = nombre;
    departamento.clave = claveDepartamento(nombre);
  }
  if ("descripcion" in body) {
    const descripcion = String(body.descripcion ?? "").trim();
    if (descripcion.length > 300) return badRequest("La descripción admite hasta 300 caracteres.");
    departamento.descripcion = descripcion;
  }
  if ("activo" in body) {
    if (typeof body.activo !== "boolean") return badRequest("Estado inválido.");
    if (!body.activo && await Rol.exists({ departamentoId: id, activo: true, retirado: { $ne: true } })) return conflict("Reasigna los puestos activos a otro departamento antes de desactivarlo.");
    departamento.activo = body.activo;
  }
  try { await departamento.save(); } catch (error) {
    if ((error as { code?: number }).code === 11000) return conflict("Ya existe ese departamento.");
    throw error;
  }
  return NextResponse.json(departamento);
}
