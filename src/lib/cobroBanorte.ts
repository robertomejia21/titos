import {
  hayQueVerificar,
  mensajeParaCajero,
  type ComandoBanorte,
  type EstadoTransaccion,
  type RespuestaPuente,
  type SolicitudPuente,
} from "@/lib/banorte";
import { ErrorPuente, ejecutarEnPuente, estadoPuente, resultadoEnPuente } from "@/lib/puenteCaja";

// Orquesta una operación con la terminal Banorte desde el navegador:
// reservar en el servidor → ejecutar en el puente → reportar → y, si no se supo
// qué pasó, verificar con Payworks y reversar. Nunca deja un cobro "quizá":
// termina aprobado, no aprobado, o reversado.

export type TransaccionServidor = {
  _id: string;
  numeroControl: string;
  comando: ComandoBanorte;
  estado: EstadoTransaccion;
  monto: number;
  autorizacion?: string;
  referencia?: string;
  ultimos4?: string;
  marca?: string;
  tipoTarjeta?: string;
  texto?: string;
  codigo?: string;
  resultado?: string;
  simulado?: boolean;
  modo?: string;
  aplicada?: boolean;
};

export type OperacionTerminal = {
  comando: "VENTA" | "CANCELACION" | "DEVOLUCION" | "OBTENER_LLAVE";
  terminalId: string;
  monto?: number;
  transaccionOriginalId?: string;
  clienteOperacionId?: string;
  ventaId?: string;
  devolucionId?: string;
};

export type ResultadoTerminal = {
  aprobada: boolean;
  estado: EstadoTransaccion;
  mensaje: string;
  transaccion: TransaccionServidor;
  respuesta: RespuestaPuente | null;
};

export type Avance =
  | "reservando"
  | "esperando_tarjeta"
  | "recuperando"
  | "verificando"
  | "reversando"
  | "registrando";

export type DependenciasCobro = {
  fetchServidor?: typeof fetch;
  fetchPuente?: typeof fetch;
  urlPuente?: string;
  alAvanzar?: (avance: Avance) => void;
  /** Espera entre reintentos al recuperar una respuesta perdida (inyectable para pruebas). */
  esperar?: (ms: number) => Promise<void>;
};

const esperarReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function jsonServidor(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Error ${res.status}`);
  return json;
}

export async function reservar(op: OperacionTerminal, f: typeof fetch = fetch) {
  const res = await f("/api/banorte/transacciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op),
  });
  return (await jsonServidor(res)) as { transaccionId: string; numeroControl: string; solicitud: SolicitudPuente };
}

async function reportar(numeroControl: string, respuesta: Partial<RespuestaPuente>, f: typeof fetch) {
  const res = await f(`/api/banorte/transacciones/${encodeURIComponent(numeroControl)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ respuesta }),
  });
  return (await jsonServidor(res)) as TransaccionServidor;
}

async function consultar(numeroControl: string, f: typeof fetch) {
  const res = await f(`/api/banorte/transacciones/${encodeURIComponent(numeroControl)}`, { cache: "no-store" });
  return (await jsonServidor(res)) as TransaccionServidor;
}

/**
 * Si el navegador perdió la respuesta, el puente sigue con la operación (el
 * cliente puede estar poniendo su NIP). Se le pregunta cada 3 s hasta que la
 * tenga o ya no esté ocupado.
 */
async function recuperarRespuesta(numeroControl: string, deps: Required<Pick<DependenciasCobro, "esperar">> & DependenciasCobro) {
  const f = deps.fetchPuente ?? fetch;
  for (let intento = 0; intento < 40; intento++) {
    const guardada = await resultadoEnPuente(numeroControl, f, deps.urlPuente);
    if (guardada) return guardada;
    const estado = await estadoPuente(f, deps.urlPuente).catch(() => null);
    if (estado && !estado.ocupado && intento > 0) return null;
    await deps.esperar(3000);
  }
  return null;
}

/** Ejecuta un comando en el puente; si se pierde la conexión, intenta recuperar la respuesta. */
async function ejecutarYRecuperar(solicitud: SolicitudPuente, deps: DependenciasCobro & { esperar: (ms: number) => Promise<void> }) {
  try {
    return await ejecutarEnPuente(solicitud, deps.fetchPuente ?? fetch, deps.urlPuente);
  } catch (err) {
    // 409: el puente está ocupado con otra cosa; 400: la solicitud está mal.
    // En ambos casos la terminal no hizo nada con esta solicitud.
    if (err instanceof ErrorPuente && !err.sinConexion) throw err;
    deps.alAvanzar?.("recuperando");
    return await recuperarRespuesta(solicitud.numeroControl, deps);
  }
}

/**
 * Resuelve una transacción dudosa: pregunta a Payworks (VERIFICACION) y, si
 * tampoco sabe que quedó aprobada, la reversa para que no haya cargo.
 */
export async function resolverDudosa(
  numeroControl: string,
  deps: DependenciasCobro = {}
): Promise<TransaccionServidor> {
  const f = deps.fetchServidor ?? fetch;
  const esperar = deps.esperar ?? esperarReal;
  const d = { ...deps, esperar };

  deps.alAvanzar?.("verificando");
  const verificacion = await ejecutarYRecuperar({ comando: "VERIFICACION", numeroControl }, d).catch(() => null);
  let tx = verificacion ? await reportar(numeroControl, { ...verificacion, comando: "VERIFICACION" }, f) : await consultar(numeroControl, f);
  if (tx.estado === "aprobada" || tx.estado === "reversada" || tx.estado === "declinada" || tx.estado === "rechazada" || tx.estado === "error") {
    return tx;
  }

  deps.alAvanzar?.("reversando");
  const reversa = await ejecutarYRecuperar(
    { comando: "REVERSA", numeroControl, ...(tx.referencia ? { referencia: tx.referencia } : {}) },
    d
  ).catch(() => null);
  if (reversa) tx = await reportar(numeroControl, { ...reversa, comando: "REVERSA" }, f);
  return tx;
}

/** Ejecuta una operación con la terminal de punta a punta. */
export async function operarTerminal(op: OperacionTerminal, deps: DependenciasCobro = {}): Promise<ResultadoTerminal> {
  const f = deps.fetchServidor ?? fetch;
  const esperar = deps.esperar ?? esperarReal;
  const d = { ...deps, esperar };

  deps.alAvanzar?.("reservando");
  const { numeroControl, solicitud } = await reservar(op, f);

  deps.alAvanzar?.("esperando_tarjeta");
  let respuesta: RespuestaPuente | null;
  try {
    respuesta = await ejecutarYRecuperar(solicitud, d);
  } catch (err) {
    // El puente rechazó la solicitud sin tocar la terminal: se registra como
    // error para que la transacción no quede pendiente para siempre.
    const mensaje = (err as Error).message;
    const tx = await reportar(numeroControl, { comando: solicitud.comando, numeroControl, resultado: "E", codigo: "PUENTE", texto: mensaje }, f);
    return { aprobada: false, estado: tx.estado, mensaje, transaccion: tx, respuesta: null };
  }

  let tx: TransaccionServidor;
  if (respuesta) {
    tx = await reportar(numeroControl, respuesta, f);
  } else {
    tx = await consultar(numeroControl, f);
  }

  const mueveDinero = op.comando !== "OBTENER_LLAVE";
  if (mueveDinero && (!respuesta || hayQueVerificar(respuesta))) {
    tx = await resolverDudosa(numeroControl, d);
  }

  const mensaje =
    tx.estado === "aprobada"
      ? "Aprobada"
      : tx.estado === "reversada"
        ? "No se pudo confirmar con Banorte y se reversó: no se cobró nada."
        : respuesta
          ? mensajeParaCajero(respuesta)
          : "No hubo respuesta de la terminal.";
  return { aprobada: tx.estado === "aprobada", estado: tx.estado, mensaje, transaccion: tx, respuesta };
}

/**
 * Regresa al cliente un cobro completo. La CANCELACION solo procede mientras el
 * lote del día sigue abierto; si Payworks la rechaza (lote cerrado), se intenta
 * una DEVOLUCION por el mismo monto. Un error de comunicación (F/E) no se
 * reintenta como devolución: la terminal ni siquiera la recibió.
 */
export async function regresarCobro(
  cobro: { terminalId: string; monto: number; transaccionOriginalId: string; ventaId?: string },
  deps: DependenciasCobro = {}
): Promise<ResultadoTerminal> {
  const cancelacion = await operarTerminal({ comando: "CANCELACION", ...cobro }, deps);
  if (cancelacion.aprobada) return cancelacion;
  const rechazadaPorPayworks = cancelacion.respuesta?.resultado === "R" || cancelacion.respuesta?.resultado === "D";
  if (!rechazadaPorPayworks) return cancelacion;
  const devolucion = await operarTerminal({ comando: "DEVOLUCION", ...cobro }, deps);
  return devolucion.aprobada ? devolucion : cancelacion;
}

/**
 * Antes de cobrar una venta que se está reintentando: ¿ya hay un cobro de ella?
 *
 * - Aprobado y sin venta (se cayó la red al registrar): se usa ese.
 * - Pendiente o sin respuesta (se perdió la respuesta de la terminal): primero
 *   se resuelve con el puente o con Payworks. Cobrar otra vez sin saber si el
 *   primero pasó es exactamente el cobro doble que hay que evitar.
 */
export async function cobroPrevioDeVenta(
  clienteOperacionId: string,
  monto: number,
  deps: DependenciasCobro = {}
): Promise<TransaccionServidor | null> {
  const f = deps.fetchServidor ?? fetch;
  const res = await f(`/api/banorte/transacciones?clienteOperacionId=${encodeURIComponent(clienteOperacionId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo revisar si esta venta ya tenía un cobro en la terminal");
  const lista = ((await res.json().catch(() => [])) as TransaccionServidor[]).filter((t) => Math.abs(t.monto - monto) < 0.005);

  const aprobada = lista.find((t) => t.estado === "aprobada" && !t.aplicada);
  if (aprobada) return aprobada;

  for (const dudosa of lista.filter((t) => t.estado === "pendiente" || t.estado === "sin_respuesta")) {
    let tx = dudosa;
    const guardada = await resultadoEnPuente(dudosa.numeroControl, deps.fetchPuente ?? fetch, deps.urlPuente);
    if (guardada && guardada.comando === "VENTA") tx = await reportar(dudosa.numeroControl, guardada, f);
    if (tx.estado === "pendiente" || tx.estado === "sin_respuesta") tx = await resolverDudosa(dudosa.numeroControl, deps);
    if (tx.estado === "aprobada" && !tx.aplicada) return tx;
  }
  return null;
}
