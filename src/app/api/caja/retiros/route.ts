import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import MovimientoCaja, { MONEDAS_CAJA } from "@/models/MovimientoCaja";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, generateFolio, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import { verifyPassword } from "@/lib/auth";
import { buscarSupervisorPorNip } from "@/lib/supervisores";
import { calcularResumenSesion, calcularEfectivoEsperado, calcularEfectivoEsperadoUsd } from "@/lib/caja";
import { contextoPuntoVenta, sucursalConsultada } from "@/lib/puntoVenta";

/** Log de retiros de la sucursal, del más reciente al más viejo. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const url = new URL(req.url);

  await connectDB();

  const sucursalId = await sucursalConsultada(session, url);
  if (!sucursalId) return badRequest("Indica la sucursal");

  const filtro: Record<string, unknown> = { sucursalId };
  const corte = url.searchParams.get("corte");
  const soloSesionActual = url.searchParams.get("sesionActual") === "1";
  if (corte) filtro.corte = corte;
  if (soloSesionActual) {
    const sesion = await CajaSesion.findOne({ sucursalId, estado: "abierta" }).select("_id").lean();
    if (!sesion) return NextResponse.json([]);
    filtro.cajaSesionId = sesion._id;
  }

  const retiros = await MovimientoCaja.find(filtro).sort({ fecha: -1 }).limit(200).lean();
  return NextResponse.json(retiros);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "caja.retirar")) return sinPermiso("caja.retirar");

  const body = await req.json().catch(() => null);
  const monto = Number(body?.monto);
  const motivo = String(body?.motivo ?? "").trim();
  const moneda = String(body?.moneda ?? "MXN");
  const password = String(body?.password ?? "");
  // El retiro se puede autorizar de dos formas: con la clave del propio cajero
  // (como siempre) o con el NIP de 6 dígitos del encargado de turno. La segunda
  // es la que se usa cuando el encargado autoriza en la caja de alguien más, y
  // deja su nombre en el movimiento.
  const nipSupervisor = String(body?.nipSupervisor ?? "").trim();

  if (!Number.isFinite(monto) || monto <= 0) return badRequest("Captura un monto válido a retirar");
  if (!motivo) return badRequest("Captura el motivo del retiro");
  if (!MONEDAS_CAJA.includes(moneda as (typeof MONEDAS_CAJA)[number])) return badRequest("Moneda inválida");
  if (!password && !nipSupervisor) {
    return badRequest("Confirma tu clave de acceso o captura el NIP del encargado de turno");
  }

  const clienteOperacionId = body?.clienteOperacionId ? String(body.clienteOperacionId) : null;

  await connectDB();

  // Reintento de un retiro que ya se había registrado: se devuelve el mismo
  // folio en lugar de sacar el dinero del cajón dos veces.
  if (clienteOperacionId) {
    const yaRegistrado = await MovimientoCaja.findOne({ clienteOperacionId });
    if (yaRegistrado) return NextResponse.json(yaRegistrado);
  }

  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  // El folio siempre queda ligado a quién sacó el dinero (el usuario de la
  // sesión); lo que cambia es quién lo autorizó.
  const usuario = await UserModel.findById(session.userId);
  if (!usuario) return unauthorized();

  let autorizadoPor: { id: string; nombre: string } | null = null;

  if (nipSupervisor) {
    autorizadoPor = await buscarSupervisorPorNip(nipSupervisor, ctx.sucursalId);
    if (!autorizadoPor) return badRequest("NIP de encargado de turno incorrecto");
  } else {
    const claveValida = await verifyPassword(password, usuario.passwordHash);
    if (!claveValida) return badRequest("Clave incorrecta");
  }

  const sesion = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" });
  if (!sesion) return badRequest("Debes abrir la caja antes de retirar efectivo");

  // No se puede retirar más de lo que hay en el cajón correspondiente.
  const resumen = await calcularResumenSesion(String(sesion._id));
  const disponible =
    moneda === "USD"
      ? calcularEfectivoEsperadoUsd(sesion.efectivoInicialUsd ?? 0, resumen)
      : calcularEfectivoEsperado(sesion.efectivoInicial, resumen);

  if (monto - disponible > 0.005) {
    return badRequest(
      `No hay suficiente efectivo en caja: disponible ${disponible.toFixed(2)} ${moneda === "USD" ? "USD" : "MXN"}`
    );
  }

  try {
    const movimiento = await MovimientoCaja.create({
      folio: generateFolio("RET"),
      ...(clienteOperacionId ? { clienteOperacionId } : {}),
      cajaSesionId: sesion._id,
      sucursalId: ctx.sucursalId,
      tipo: "retiro",
      moneda,
      monto,
      motivo,
      usuarioId: session.userId,
      usuarioNombre: usuario.nombre,
      autorizadoPorId: autorizadoPor?.id ?? null,
      autorizadoPorNombre: autorizadoPor?.nombre ?? "",
      fecha: new Date(),
      corte: todayCorte(await zonaHorariaDeSucursal(ctx.sucursalId)),
    });
    return NextResponse.json(movimiento, { status: 201 });
  } catch (err) {
    const codigo = (err as { code?: number }).code;
    if (codigo === 11000 && clienteOperacionId) {
      const ganador = await MovimientoCaja.findOne({ clienteOperacionId });
      if (ganador) return NextResponse.json(ganador);
    }
    throw err;
  }
}
