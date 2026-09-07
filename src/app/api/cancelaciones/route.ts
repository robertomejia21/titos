import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CancelacionPos, { TIPOS_CANCELACION } from "@/models/CancelacionPos";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { verificarNipSupervisor } from "@/lib/configuracion";
import { normalizarItemsCancelados, registrarCancelacion, type TipoCancelacion } from "@/lib/cancelaciones";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

/** Bitácora de cancelaciones. Matriz ve todas; una sucursal solo las suyas. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const url = new URL(req.url);
  const filtro: Record<string, unknown> = {};

  if (session.role === "sucursal") {
    if (!session.sucursalId) return forbidden();
    filtro.sucursalId = session.sucursalId;
  } else {
    const sucursalId = url.searchParams.get("sucursalId");
    if (sucursalId) filtro.sucursalId = sucursalId;
  }

  const tipo = url.searchParams.get("tipo");
  if (tipo && TIPOS_CANCELACION.includes(tipo as TipoCancelacion)) filtro.tipo = tipo;

  // El corte ya viene en YYYY-MM-DD y en la zona de la sucursal, así que se
  // compara como texto (mismo criterio que el resto de los reportes).
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (desde || hasta) {
    const rango: Record<string, string> = {};
    if (desde) rango.$gte = desde;
    if (hasta) rango.$lte = hasta;
    filtro.corte = rango;
  }

  const cancelaciones = await CancelacionPos.find(filtro).sort({ fecha: -1 }).limit(500).lean();

  return NextResponse.json(
    cancelaciones.map((c) => ({
      ...c,
      _id: String(c._id),
      sucursalId: String(c.sucursalId),
      fecha: c.fecha ? new Date(c.fecha).toISOString() : null,
    }))
  );
}

/**
 * Registra una cancelación hecha en el carrito del punto de venta (quitar un
 * producto o vaciar/cancelar la venta antes de cobrarla). Las ventas ya cobradas
 * se cancelan por /api/ventas/[id]/cancelar, que además devuelve el stock.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pos.cancelar")) return sinPermiso("pos.cancelar");

  const body = await req.json().catch(() => null);
  const tipo = String(body?.tipo ?? "");
  const motivo = String(body?.motivo ?? "").trim();
  const nip = String(body?.nip ?? "").trim();

  if (tipo !== "linea" && tipo !== "carrito") {
    return badRequest("Tipo de cancelación inválido");
  }
  if (!motivo) return badRequest("Captura el motivo de la cancelación");

  await connectDB();

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const autorizacion = await verificarNipSupervisor(nip, ctx.sucursalId);
  if (!autorizacion.ok) return badRequest(autorizacion.error);

  const items = normalizarItemsCancelados(body?.items);
  if (items.length === 0) return badRequest("La cancelación debe indicar al menos un producto");

  const registro = await registrarCancelacion({
    tipo,
    ctx,
    session,
    motivo,
    autorizadoConNip: autorizacion.autorizadoConNip,
    autorizadoPor: autorizacion.autorizadoPor ?? null,
    items,
  });

  return NextResponse.json(
    {
      folio: registro.folio,
      autorizadoConNip: registro.autorizadoConNip,
      autorizadoPorNombre: registro.autorizadoPorNombre,
    },
    { status: 201 }
  );
}
