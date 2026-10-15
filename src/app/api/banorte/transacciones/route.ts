import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import TransaccionBanorte from "@/models/TransaccionBanorte";
import "@/models/Sucursal"; // para populate("sucursalId")
import "@/models/User"; // para populate("usuarioId")
import { requireSession, unauthorized, forbidden, badRequest, puede } from "@/lib/apiAuth";
import { contextoPuntoVenta, sucursalConsultada } from "@/lib/puntoVenta";
import { ErrorBanorte, reservarTransaccion } from "@/lib/banorteServidor";
import { ESTADOS_TRANSACCION, COMANDOS_BANORTE } from "@/lib/banorte";

/**
 * Bitácora de operaciones con la terminal Banorte.
 *
 * - `?clienteOperacionId=…` (punto de venta): el cobro de una venta que no
 *   alcanzó a registrarse, para retomarlo en vez de cobrar otra vez.
 * - Sin ese parámetro: el listado de la tienda (o de la que indique matriz).
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  await connectDB();
  const url = new URL(req.url);

  const clienteOperacionId = url.searchParams.get("clienteOperacionId");
  if (clienteOperacionId) {
    const ctx = await contextoPuntoVenta(session);
    if (!ctx) return forbidden();
    const transacciones = await TransaccionBanorte.find({ sucursalId: ctx.sucursalId, clienteOperacionId, comando: "VENTA" })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    return NextResponse.json(transacciones);
  }

  if (!puede(session, "catalogos.administrar") && !puede(session, "cortes.ver") && !puede(session, "pos.vender")) {
    return forbidden();
  }

  const filtro: Record<string, unknown> = {};
  if (session.role === "matriz") {
    const sucursalId = url.searchParams.get("sucursalId");
    if (sucursalId) filtro.sucursalId = sucursalId;
  } else {
    const sucursalId = await sucursalConsultada(session, url);
    if (!sucursalId) return badRequest("Indica la sucursal");
    filtro.sucursalId = sucursalId;
  }
  const estado = url.searchParams.get("estado");
  if (estado && (ESTADOS_TRANSACCION as readonly string[]).includes(estado)) filtro.estado = estado;
  const comando = url.searchParams.get("comando");
  if (comando && (COMANDOS_BANORTE as readonly string[]).includes(comando)) filtro.comando = comando;
  // Cobros aprobados que no quedaron amarrados a ninguna venta: el banco cobró
  // pero en Titos no hay venta. Son los que hay que revisar a mano.
  if (url.searchParams.get("sinVenta")) Object.assign(filtro, { comando: "VENTA", estado: "aprobada", aplicada: false });
  const desde = url.searchParams.get("desde");
  if (desde && !Number.isNaN(Date.parse(desde))) filtro.createdAt = { $gte: new Date(desde) };

  const transacciones = await TransaccionBanorte.find(filtro)
    .sort({ createdAt: -1 })
    .limit(300)
    .populate("sucursalId", "nombre")
    .populate("usuarioId", "nombre")
    .lean();
  return NextResponse.json(transacciones);
}

/** Reserva un número de control y devuelve la solicitud para el puente de caja. */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  try {
    const reserva = await reservarTransaccion(session, ctx, body);
    return NextResponse.json(reserva, { status: 201 });
  } catch (err) {
    if (err instanceof ErrorBanorte) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
