import { NextRequest, NextResponse } from "next/server";
import { filtroCajaAbierta } from "@/lib/numeroCaja";
import { connectDB } from "@/lib/db";
import Cliente from "@/models/Cliente";
import CuentaPorCobrar from "@/models/CuentaPorCobrar";
import AbonoCliente, { METODOS_ABONO } from "@/models/AbonoCliente";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, notFound, badRequest, todayCorte } from "@/lib/apiAuth";
import {
  EPSILON,
  aplicarAbonoFIFO,
  recalcularSaldoCliente,
  redondear,
  zonaHorariaDeSucursal,
  type CuentaLike,
} from "@/lib/credito";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const monto = redondear(Number(body?.monto));
  const metodoPago = String(body?.metodoPago ?? "");
  const notas = String(body?.notas ?? "").trim();

  if (!Number.isFinite(monto) || monto <= 0) return badRequest("El monto del abono debe ser mayor a cero");
  if (!METODOS_ABONO.includes(metodoPago as (typeof METODOS_ABONO)[number])) {
    return badRequest("Método de pago inválido");
  }

  await connectDB();

  const ctx = await contextoPuntoVenta(session, req);
  if (!ctx) return forbidden();

  const cliente = await Cliente.findById(id);
  if (!cliente || String(cliente.sucursalId) !== String(ctx.sucursalId)) {
    return notFound("Cliente no encontrado");
  }

  const cuentas = (await CuentaPorCobrar.find({ clienteId: id, estado: "pendiente" })) as unknown as (CuentaLike & {
    saldo: number;
    estado: string;
    save: () => Promise<unknown>;
  })[];

  const deuda = redondear(cuentas.reduce((sum, c) => sum + c.saldo, 0));
  if (deuda <= EPSILON) return badRequest("Este cliente no tiene deuda pendiente");
  if (monto - deuda > EPSILON) {
    return badRequest(`El abono excede la deuda del cliente (debe ${deuda.toFixed(2)})`);
  }

  // El efectivo que entra al cajón tiene que caer en la sesión de caja abierta
  // para que aparezca en el corte.
  let cajaSesionId: unknown = null;
  if (metodoPago === "efectivo") {
    const sesionCaja = await CajaSesion.findOne(filtroCajaAbierta(ctx));
    if (!sesionCaja) return badRequest("Debes abrir la caja antes de recibir un abono en efectivo");
    cajaSesionId = sesionCaja._id;
  }

  const { aplicaciones } = aplicarAbonoFIFO(cuentas, monto);
  const cuentaPorId = new Map(cuentas.map((c) => [String(c._id), c]));

  for (const aplicacion of aplicaciones) {
    const cuenta = cuentaPorId.get(String(aplicacion.cuentaId));
    if (!cuenta) continue;
    cuenta.saldo = aplicacion.saldoRestante;
    if (cuenta.saldo <= EPSILON) {
      cuenta.saldo = 0;
      cuenta.estado = "pagada";
    }
    await cuenta.save();
  }

  const abono = await AbonoCliente.create({
    clienteId: cliente._id,
    sucursalId: ctx.sucursalId,
    cajaSesionId,
    usuarioId: session.userId,
    fecha: new Date(),
    corte: todayCorte(await zonaHorariaDeSucursal(ctx.sucursalId)),
    monto,
    metodoPago,
    aplicaciones: aplicaciones.map((a) => ({ cuentaId: a.cuentaId, folio: a.folio, monto: a.monto })),
    notas,
  });

  const saldo = await recalcularSaldoCliente(cliente._id);

  return NextResponse.json({ abono, saldo }, { status: 201 });
}
