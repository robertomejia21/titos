import TransaccionBanorte from "@/models/TransaccionBanorte";
import TerminalPago from "@/models/TerminalPago";
import CajaSesion from "@/models/CajaSesion";
import type { SessionPayload } from "@/lib/auth";
import type { ContextoPuntoVenta } from "@/lib/puntoVenta";
import { puede } from "@/lib/apiAuth";
import { redondear } from "@/lib/credito";
import {
  COMANDOS_CON_MONTO,
  estadoDeResultado,
  estadoDeVerificacion,
  leerVerificacion,
  limpiarRespuesta,
  nuevoNumeroControl,
  type ComandoBanorte,
  type DatosBanortePago,
  type EstadoTransaccion,
  type RespuestaPuente,
  type SolicitudPuente,
} from "@/lib/banorte";

/** Error de negocio con el status HTTP que le corresponde. */
export class ErrorBanorte extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Comandos que se reservan con número de control propio. La VERIFICACION y la
// REVERSA no: operan con el número de control de la transacción original.
const COMANDOS_RESERVABLES = ["OBTENER_LLAVE", "VENTA", "CANCELACION", "DEVOLUCION"] as const;
type ComandoReservable = (typeof COMANDOS_RESERVABLES)[number];

const PERMISO_COMANDO: Record<ComandoReservable, string[]> = {
  VENTA: ["pos.vender"],
  CANCELACION: ["pos.cancelar"],
  DEVOLUCION: ["devoluciones.registrar"],
  // La carga de llave no mueve dinero; la hace el técnico desde la caja o
  // matriz al configurar la terminal.
  OBTENER_LLAVE: ["pos.vender", "catalogos.administrar", "configuracion.editar"],
};

export function esComandoReservable(c: unknown): c is ComandoReservable {
  return typeof c === "string" && (COMANDOS_RESERVABLES as readonly string[]).includes(c);
}

type TerminalIntegrada = { _id: unknown; alias: string; afiliacion?: string; cobroIntegrado?: boolean };

export async function terminalIntegradaDe(ctx: ContextoPuntoVenta, terminalId: unknown): Promise<TerminalIntegrada> {
  if (!terminalId) throw new ErrorBanorte("Indica la terminal con la que se va a cobrar");
  const terminal = await TerminalPago.findOne({ _id: String(terminalId), sucursalId: ctx.sucursalId, activo: true })
    .select("alias afiliacion cobroIntegrado")
    .lean<TerminalIntegrada>()
    .catch(() => null);
  if (!terminal) throw new ErrorBanorte("La terminal no existe o ya no está activa en esta tienda");
  if (!terminal.cobroIntegrado) throw new ErrorBanorte("Esa terminal no tiene el cobro integrado con Banorte");
  return terminal;
}

type Reserva = {
  comando: unknown;
  terminalId: unknown;
  monto?: unknown;
  transaccionOriginalId?: unknown;
  clienteOperacionId?: unknown;
  ventaId?: unknown;
  devolucionId?: unknown;
};

/**
 * Crea la transacción "pendiente" con su número de control y devuelve la
 * solicitud exacta que el navegador le tiene que pasar al puente de caja. El
 * monto y la referencia los decide el servidor, no el navegador.
 */
export async function reservarTransaccion(session: SessionPayload, ctx: ContextoPuntoVenta, body: Reserva) {
  const comando = body.comando;
  if (!esComandoReservable(comando)) throw new ErrorBanorte("Comando inválido");
  const permisos = PERMISO_COMANDO[comando];
  if (!permisos.some((p) => puede(session, p))) throw new ErrorBanorte("No tienes permiso para esta operación", 403);

  const terminal = await terminalIntegradaDe(ctx, body.terminalId);
  const caja = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" }).select("_id").lean<{ _id: unknown }>();
  if (comando === "VENTA" && !caja) throw new ErrorBanorte("Debes abrir la caja antes de cobrar");

  let monto = 0;
  if (COMANDOS_CON_MONTO.includes(comando)) {
    monto = redondear(Number(body.monto));
    if (!Number.isFinite(monto) || monto <= 0) throw new ErrorBanorte("El monto debe ser mayor a cero");
    if (monto > 999999) throw new ErrorBanorte("Monto fuera de rango");
  }

  let original: Awaited<ReturnType<typeof ventaOriginalAprobada>> | null = null;
  if (comando === "CANCELACION" || comando === "DEVOLUCION") {
    original = await ventaOriginalAprobada(ctx, body.transaccionOriginalId);
    const disponible = redondear((original.monto ?? 0) - (original.montoDevuelto ?? 0));
    if (comando === "CANCELACION" && Math.abs(monto - (original.monto ?? 0)) > 0.005) {
      throw new ErrorBanorte("La cancelación es por el total del cobro; para una parte usa una devolución");
    }
    if (monto - disponible > 0.005) {
      throw new ErrorBanorte(`Del cobro original solo quedan ${disponible.toFixed(2)} por devolver`);
    }
  }

  const solicitud: SolicitudPuente = { comando, numeroControl: nuevoNumeroControl() };
  if (monto) solicitud.monto = monto;
  if (original?.referencia) solicitud.referencia = original.referencia;

  const transaccion = await TransaccionBanorte.create({
    numeroControl: solicitud.numeroControl,
    comando,
    monto,
    sucursalId: ctx.sucursalId,
    cajaSesionId: caja?._id ?? null,
    usuarioId: session.userId,
    terminalId: terminal._id,
    terminalAlias: terminal.alias,
    afiliacion: terminal.afiliacion ?? "",
    transaccionOriginalId: original?._id ?? null,
    referenciaOriginal: original?.referencia ?? "",
    clienteOperacionId: typeof body.clienteOperacionId === "string" ? body.clienteOperacionId.slice(0, 80) : "",
    ventaId: body.ventaId ? String(body.ventaId) : original?.ventaId ?? null,
    devolucionId: body.devolucionId ? String(body.devolucionId) : null,
  });

  return { transaccionId: String(transaccion._id), numeroControl: solicitud.numeroControl, solicitud };
}

async function ventaOriginalAprobada(ctx: ContextoPuntoVenta, id: unknown) {
  if (!id) throw new ErrorBanorte("Indica el cobro original");
  const original = await TransaccionBanorte.findOne({ _id: String(id), sucursalId: ctx.sucursalId })
    .catch(() => null);
  if (!original) throw new ErrorBanorte("El cobro original no existe en esta tienda");
  if (original.comando !== "VENTA" || original.estado !== "aprobada") {
    throw new ErrorBanorte("Solo se puede cancelar o devolver un cobro aprobado");
  }
  if (!original.referencia) throw new ErrorBanorte("El cobro original no tiene referencia de Payworks");
  return original;
}

// Estados que ya no cambian con un reporte normal. Una "sin_respuesta" o
// "pendiente" sí puede cambiar: es justo lo que resuelve la verificación.
const FINALES: EstadoTransaccion[] = ["aprobada", "declinada", "rechazada", "error", "reversada"];

/**
 * Registra lo que contestó el puente para la transacción `numeroControl`.
 *
 * `respuesta.comando` dice qué se ejecutó: el comando original, o una
 * VERIFICACION / REVERSA que se mandó con el mismo número de control para
 * resolver una transacción dudosa.
 */
export async function registrarRespuesta(ctx: ContextoPuntoVenta, numeroControl: string, respuesta: Partial<RespuestaPuente>) {
  const transaccion = await TransaccionBanorte.findOne({ numeroControl, sucursalId: ctx.sucursalId });
  if (!transaccion) throw new ErrorBanorte("La transacción no existe en esta tienda", 404);
  if (respuesta.numeroControl && respuesta.numeroControl !== numeroControl) {
    throw new ErrorBanorte("La respuesta es de otro número de control");
  }

  const datos = limpiarRespuesta(respuesta);
  const ejecutado = respuesta.comando;
  let estado: EstadoTransaccion;

  if (ejecutado === "VERIFICACION") {
    const v = leerVerificacion(datos.texto);
    // Sin el formato de la tabla, la verificación aprobada al menos dice que la
    // transacción existe y quedó aprobada.
    const desdeTexto = v ? estadoDeVerificacion(v) : null;
    const desdeResultado =
      // PAYW-3012: Payworks no conoce ese número de control, o sea que el cobro
      // nunca llegó al banco.
      datos.resultado === "A" ? "aprobada" : datos.codigo.toUpperCase().includes("3012") ? "error" : null;
    const verificado = desdeTexto ?? desdeResultado;
    if (!verificado) {
      transaccion.nota = `Verificación sin respuesta clara: ${datos.texto || datos.codigo}`.slice(0, 200);
      await transaccion.save();
      return transaccion;
    }
    estado = verificado;
    if (v) {
      if (v.referencia && !datos.referencia) datos.referencia = v.referencia;
      if (v.autorizacion && !datos.autorizacion) datos.autorizacion = v.autorizacion;
      if (v.ultimos4 && !datos.ultimos4) datos.ultimos4 = v.ultimos4;
      if (v.marca && !datos.marca) datos.marca = v.marca;
      if (v.tipoTarjeta && !datos.tipoTarjeta) datos.tipoTarjeta = v.tipoTarjeta;
      if (v.banco && !datos.banco) datos.banco = v.banco;
    }
    // La verificación no trae resultado de la transacción en sí: no se
    // sobrescriben los datos buenos con los vacíos.
    datos.resultado = estado === "aprobada" ? "A" : datos.resultado;
  } else if (ejecutado === "REVERSA") {
    if (datos.resultado !== "A") {
      transaccion.nota = `La reversa no se aplicó: ${datos.texto || datos.codigo}`.slice(0, 200);
      await transaccion.save();
      return transaccion;
    }
    estado = "reversada";
  } else {
    if (ejecutado && ejecutado !== transaccion.comando) throw new ErrorBanorte("La respuesta es de otro comando");
    estado = estadoDeResultado(datos.resultado);
    if (FINALES.includes(transaccion.estado as EstadoTransaccion) && transaccion.estado !== estado) {
      throw new ErrorBanorte("Esta transacción ya tiene un resultado final", 409);
    }
  }

  // Un cobro ya aplicado a una venta solo puede pasar a "reversada"; cualquier
  // otro cambio dejaría una venta cobrada amarrada a un cobro inexistente.
  if (transaccion.aplicada && estado !== "aprobada" && estado !== "reversada") {
    throw new ErrorBanorte("Este cobro ya está amarrado a una venta", 409);
  }

  if (datos.afiliacion && transaccion.afiliacion && datos.afiliacion !== transaccion.afiliacion) {
    transaccion.nota = `Payworks contestó con la afiliación ${datos.afiliacion}, distinta a la de la terminal (${transaccion.afiliacion})`;
  }

  const anterior = transaccion.estado;
  transaccion.estado = estado;
  transaccion.respondidaEn = new Date();
  for (const [k, v] of Object.entries(datos)) {
    if (k === "resultado" && ejecutado === "REVERSA") continue;
    // Una reversa o verificación no trae los datos de la tarjeta: se conservan.
    if ((ejecutado === "REVERSA" || ejecutado === "VERIFICACION") && (v === "" || v === false)) continue;
    if (k === "afiliacion" && !v) continue;
    transaccion.set(k, v);
  }
  if (ejecutado === "REVERSA") transaccion.nota = "Reversada por falta de respuesta";
  await transaccion.save();

  // Una cancelación o devolución aprobada descuenta del cobro original.
  if (
    estado === "aprobada" &&
    anterior !== "aprobada" &&
    (transaccion.comando === "CANCELACION" || transaccion.comando === "DEVOLUCION") &&
    transaccion.transaccionOriginalId
  ) {
    await TransaccionBanorte.updateOne(
      { _id: transaccion.transaccionOriginalId },
      { $inc: { montoDevuelto: transaccion.monto }, $set: { anuladaPorId: transaccion._id } }
    );
  }

  return transaccion;
}

type TransaccionDoc = {
  _id: unknown;
  numeroControl: string;
  referencia?: string;
  autorizacion?: string;
  afiliacion?: string;
  ultimos4?: string;
  marca?: string;
  tipoTarjeta?: string;
  banco?: string;
  modoEntrada?: string;
  pinValidado?: boolean;
  aid?: string;
  tvr?: string;
  appNombre?: string;
  modo?: string;
  simulado?: boolean;
  respondidaEn?: Date | null;
};

/** Lo que se congela en el pago de la venta para el voucher y para cancelar. */
export function datosParaVenta(t: TransaccionDoc): DatosBanortePago & { transaccionId: unknown } {
  return {
    transaccionId: t._id,
    numeroControl: t.numeroControl,
    referencia: t.referencia ?? "",
    autorizacion: t.autorizacion ?? "",
    afiliacion: t.afiliacion ?? "",
    ultimos4: t.ultimos4 ?? "",
    marca: t.marca ?? "",
    tipoTarjeta: t.tipoTarjeta ?? "",
    banco: t.banco ?? "",
    modoEntrada: t.modoEntrada ?? "",
    pinValidado: !!t.pinValidado,
    aid: t.aid ?? "",
    tvr: t.tvr ?? "",
    appNombre: t.appNombre ?? "",
    modo: t.modo ?? "",
    simulado: !!t.simulado,
    fecha: t.respondidaEn ?? null,
  };
}

/** Comandos que pueden verse en el listado de matriz. */
export const COMANDOS_LISTABLES: ComandoBanorte[] = ["VENTA", "CANCELACION", "DEVOLUCION", "OBTENER_LLAVE"];
