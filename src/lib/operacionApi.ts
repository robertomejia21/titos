import type { NextRequest } from "next/server";
import { requireSession, unauthorized, forbidden, sinPermiso, puede } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import Empleado from "@/models/Empleado";
import type { SessionPayload } from "@/lib/auth";

/** Puestos que manejan unidad: los choferes de ruta y los repartidores que ya existían. */
export const PUESTOS_CHOFER = ["Chofer", "Repartidor"];

export async function listarChoferes() {
  return Empleado.find({ puesto: { $in: PUESTOS_CHOFER } }).select("nombre puesto whatsapp activo").sort({ nombre: 1 }).lean();
}

/**
 * Sesión de matriz con alguno de los permisos dados. Devuelve la respuesta de
 * error lista para regresar, o la sesión ya con la base conectada.
 */
export async function sesionOperacion(req: NextRequest, ...permisos: string[]): Promise<{ session: SessionPayload; error?: undefined } | { error: Response; session?: undefined }> {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role !== "matriz") return { error: forbidden() };
  if (!permisos.some((p) => puede(session, p))) return { error: sinPermiso(permisos[0]) };
  await connectDB();
  return { session };
}

export function texto(valor: unknown, max = 200) {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

export function idONull(valor: unknown) {
  return typeof valor === "string" && /^[a-f0-9]{24}$/i.test(valor) ? valor : null;
}

export const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
