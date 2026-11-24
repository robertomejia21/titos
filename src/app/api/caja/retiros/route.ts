import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CajaSesion from "@/models/CajaSesion";
import MovimientoCaja, { DENOMINACIONES_MXN, MONEDAS_CAJA, ORIGENES_RETIRO, type OrigenRetiro } from "@/models/MovimientoCaja";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, generateFolio, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import { verifyPassword } from "@/lib/auth";
import { buscarSupervisorPorNip } from "@/lib/supervisores";
import { calcularResumenSesion, calcularEfectivoEsperado, calcularEfectivoEsperadoUsd } from "@/lib/caja";
import { filtroCajaAbierta, numeroCajaDe } from "@/lib/numeroCaja";
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
    const sesion = await CajaSesion.findOne(filtroCajaAbierta({ sucursalId, numeroCaja: numeroCajaDe(req) })).select("_id").lean();
    if (!sesion) return NextResponse.json([]);
    filtro.cajaSesionId = sesion._id;
  }

  const retiros = await MovimientoCaja.find(filtro).sort({ fecha: -1 }).limit(200).lean();
  return NextResponse.json(retiros);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const origen = String(body?.origen ?? "manual") as OrigenRetiro;
  if (!ORIGENES_RETIRO.includes(origen)) return badRequest("Origen de retiro inválido");

  // El retiro por límite de efectivo lo pide el propio sistema en cualquier
  // caja, aunque el cajero no tenga el permiso de retirar: quien autoriza y se
  // lleva el dinero es el gerente con su NIP, que se exige más abajo.
  const permitido = puede(session, "caja.retirar") || (origen === "limite" && puede(session, "pos.vender"));
  if (!permitido) return sinPermiso("caja.retirar");

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
  if (origen === "limite") {
    if (moneda !== "MXN") return badRequest("El retiro por límite de efectivo es en pesos");
    if (!nipSupervisor) return badRequest("El retiro por límite de efectivo lo autoriza el gerente con su NIP");
  } else if (!password && !nipSupervisor) {
    return badRequest("Confirma tu clave de acceso o captura el NIP del encargado de turno");
  }

  // Desglose opcional de billetes y monedas entregados. Si viene, tiene que
  // cuadrar con el monto: es lo que el gerente firma que recibió.
  let desglose: { denominacion: number; cantidad: number }[] = [];
  if (Array.isArray(body?.desglose) && body.desglose.length > 0) {
    if (moneda !== "MXN") return badRequest("El desglose de billetes solo aplica a pesos");
    for (const renglon of body.desglose as unknown[]) {
      const denominacion = Number((renglon as { denominacion?: unknown })?.denominacion);
      const cantidad = Number((renglon as { cantidad?: unknown })?.cantidad);
      if (!DENOMINACIONES_MXN.includes(denominacion as (typeof DENOMINACIONES_MXN)[number])) {
        return badRequest("Denominación inválida en el desglose");
      }
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 100000) {
        return badRequest("Cantidad inválida en el desglose");
      }
      if (cantidad > 0) desglose.push({ denominacion, cantidad });
    }
    desglose = desglose.sort((a, b) => b.denominacion - a.denominacion);
    const sumaDesglose = desglose.reduce((s, r) => s + r.denominacion * r.cantidad, 0);
    if (Math.abs(sumaDesglose - monto) > 0.005) {
      return badRequest(`El desglose suma ${sumaDesglose.toFixed(2)} y el monto es ${monto.toFixed(2)}: deben coincidir`);
    }
  }

  const clienteOperacionId = body?.clienteOperacionId ? String(body.clienteOperacionId) : null;

  await connectDB();

  // Reintento de un retiro que ya se había registrado: se devuelve el mismo
  // folio en lugar de sacar el dinero del cajón dos veces.
  if (clienteOperacionId) {
    const yaRegistrado = await MovimientoCaja.findOne({ clienteOperacionId });
    if (yaRegistrado) return NextResponse.json(yaRegistrado);
  }

  const ctx = await contextoPuntoVenta(session, req);
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

  const sesion = await CajaSesion.findOne(filtroCajaAbierta(ctx));
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
      origen,
      efectivoAntes: disponible,
      efectivoDespues: Number((disponible - monto).toFixed(2)),
      desglose,
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
