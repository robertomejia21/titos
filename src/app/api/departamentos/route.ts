import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, puede, badRequest, conflict } from "@/lib/apiAuth";
import Departamento from "@/models/Departamento";
import { claveDepartamento } from "@/lib/departamentos";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "usuarios.administrar")) return forbidden();
  await connectDB();
  return NextResponse.json(await Departamento.find({}).sort({ nombre: 1 }).lean());
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "usuarios.administrar")) return forbidden();
  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const descripcion = String(body?.descripcion ?? "").trim();
  if (!nombre || nombre.length > 80 || descripcion.length > 300) return badRequest("Escribe un nombre de hasta 80 caracteres y una descripción de hasta 300.");
  await connectDB();
  try {
    const departamento = await Departamento.create({ nombre, descripcion, clave: claveDepartamento(nombre) });
    return NextResponse.json(departamento, { status: 201 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return conflict("Ya existe ese departamento, revisa también los inactivos.");
    throw error;
  }
}
