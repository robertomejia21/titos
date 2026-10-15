import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import TerminalPago from "@/models/TerminalPago";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, badRequest, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

/**
 * `?puntoVenta=1` devuelve las terminales activas del punto de venta que está
 * operando la sesión (la sucursal del usuario, o el mostrador si es matriz). Es
 * lo que consume el POS para poblar el selector al cobrar con tarjeta.
 *
 * Sin ese parámetro es la vista de administración de matriz: todas las
 * terminales de todas las sucursales.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();
  const url = new URL(req.url);

  if (url.searchParams.get("puntoVenta")) {
    const ctx = await contextoPuntoVenta(session);
    if (!ctx) return forbidden();
    const terminales = await TerminalPago.find({ sucursalId: ctx.sucursalId, activo: true })
      .select("alias banco marca cobroIntegrado afiliacion numeroSerie")
      .sort({ alias: 1 })
      .lean();
    return NextResponse.json(terminales.map((t) => ({ ...t, _id: String(t._id) })));
  }

  if (session.role !== "matriz") return forbidden();

  const filtro: Record<string, unknown> = {};
  const sucursalId = url.searchParams.get("sucursalId");
  if (sucursalId) filtro.sucursalId = sucursalId;
  if (!url.searchParams.get("todos")) filtro.activo = true;

  const terminales = await TerminalPago.find(filtro)
    .populate("sucursalId", "nombre")
    .sort({ alias: 1 })
    .lean();

  return NextResponse.json(terminales);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "catalogos.administrar")) return sinPermiso("catalogos.administrar");
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  const alias = String(body?.alias ?? "").trim();
  const sucursalId = String(body?.sucursalId ?? "").trim();

  if (!sucursalId) return badRequest("Elige la sucursal donde está la terminal");
  if (!alias) return badRequest("Ponle un nombre a la terminal (es el que verá el cajero al cobrar)");
  if (body?.cobroIntegrado === true && !String(body?.afiliacion ?? "").replace(/\D/g, "")) {
    return badRequest("Para el cobro integrado captura la afiliación Banorte de la terminal");
  }

  await connectDB();

  const sucursal = await Sucursal.findById(sucursalId).select("_id").lean();
  if (!sucursal) return badRequest("La sucursal no existe");

  try {
    const terminal = await TerminalPago.create({
      sucursalId,
      alias,
      banco: String(body?.banco ?? "").trim(),
      marca: String(body?.marca ?? "").trim(),
      numeroSerie: String(body?.numeroSerie ?? "").trim(),
      cobroIntegrado: body?.cobroIntegrado === true,
      afiliacion: String(body?.afiliacion ?? "").replace(/\D/g, ""),
    });
    return NextResponse.json(terminal, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return conflict("Esa sucursal ya tiene una terminal con ese nombre");
    }
    throw err;
  }
}
