import type { TipoTarjeta } from "@/lib/tarjetas";

// Cobro integrado con la terminal Banorte (Payworks · Interredes Remoto).
//
// El navegador NO habla con la terminal ni con Banorte. Quien lo hace es el
// "puente de caja": un programa que corre en la PC de caja, en la misma red
// que la PinPad, y que llama a la DLL PINPAD.TPV de Banorte. El usuario y la
// contraseña del Motor Payworks viven solo en esa PC; a la nube únicamente
// llega el resultado (autorización, referencia, últimos 4 y marca), nunca el
// número de la tarjeta.
//
// Flujo de un cobro:
//   1. El punto de venta reserva un número de control en el servidor
//      (POST /api/banorte/transacciones). Queda una transacción "pendiente".
//   2. Le pide al puente que ejecute el comando con ese número de control.
//   3. Reporta al servidor lo que contestó el puente (PATCH …/[numeroControl]).
//   4. Si fue aprobada, la venta se registra amarrada a ese número de control.
// Si en el paso 2 se pierde la respuesta, el número de control permite
// preguntarle a Payworks qué pasó (VERIFICACION) y, si hace falta, reversar.

export const COMANDOS_BANORTE = [
  "OBTENER_LLAVE",
  "VENTA",
  "CANCELACION",
  "DEVOLUCION",
  "REVERSA",
  "VERIFICACION",
] as const;
export type ComandoBanorte = (typeof COMANDOS_BANORTE)[number];

/** Comandos que mueven dinero y por eso llevan monto. */
export const COMANDOS_CON_MONTO: readonly ComandoBanorte[] = ["VENTA", "CANCELACION", "DEVOLUCION"];
/** Comandos que operan sobre una transacción anterior. */
export const COMANDOS_REFERENCIADOS: readonly ComandoBanorte[] = ["CANCELACION", "DEVOLUCION", "REVERSA"];

// A/D/R/T son los resultados de Payworks (Anexo V). F son errores de la PinPad
// (códigos -2xxx) y E errores de la DLL (-1xxx), ambos del Anexo VI: en esos
// casos la operación no llegó a autorizarse.
export const RESULTADOS_PAYW = ["A", "D", "R", "T", "F", "E"] as const;
export type ResultadoPayw = (typeof RESULTADOS_PAYW)[number];

export const ESTADOS_TRANSACCION = [
  "pendiente", // reservada, todavía sin respuesta del puente
  "aprobada",
  "declinada",
  "rechazada",
  "sin_respuesta", // Payworks no supo qué pasó (T) o se perdió la respuesta
  "error", // la terminal o la DLL no la procesaron (F/E)
  "reversada",
] as const;
export type EstadoTransaccion = (typeof ESTADOS_TRANSACCION)[number];

export const MODOS_PAYWORKS = ["PRD", "AUT", "DEC", "RND"] as const;
export type ModoPayworks = (typeof MODOS_PAYWORKS)[number];

/** Lo que el puente de caja le manda ejecutar a la PinPad. */
export type SolicitudPuente = {
  comando: ComandoBanorte;
  numeroControl: string;
  monto?: number;
  /** Referencia Payworks de la transacción original (cancelación, devolución, reversa). */
  referencia?: string;
  autorizacion?: string;
};

/** Respuesta del puente de caja: los parámetros de salida de la DLL, ya sin datos sensibles. */
export type RespuestaPuente = {
  ok: boolean;
  comando: ComandoBanorte;
  numeroControl: string;
  resultado: ResultadoPayw;
  /** PPGetPaywCode: motivo del rechazo, o el código -1xxx/-2xxx en errores F/E. */
  codigo?: string;
  texto?: string;
  autorizacion?: string;
  referencia?: string;
  afiliacion?: string;
  /** CREDITO / DEBITO, tal como lo manda el autorizador. */
  tipoTarjeta?: string;
  marca?: string;
  banco?: string;
  /** Primeros dígitos; el número completo nunca sale del puente. */
  bin?: string;
  ultimos4?: string;
  /** BANDA, CHIP, CONTACTLESSCHIP o MANUAL. */
  modoEntrada?: string;
  /** El tarjetahabiente se validó con PIN (no hace falta firma). */
  pinValidado?: boolean;
  resultadoAutorizador?: string;
  aid?: string;
  tvr?: string;
  appPrefName?: string;
  appLabel?: string;
  fechaSolicitud?: string;
  fechaRespuesta?: string;
  modo?: ModoPayworks;
  /** El puente corre sin la DLL real: nada llegó a Banorte. */
  simulado?: boolean;
};

/** Datos de un cobro con terminal integrada que se guardan en la venta y salen en el voucher. */
export type DatosBanortePago = {
  numeroControl: string;
  referencia: string;
  autorizacion: string;
  afiliacion: string;
  ultimos4: string;
  marca: string;
  tipoTarjeta: string;
  banco: string;
  modoEntrada: string;
  pinValidado: boolean;
  aid: string;
  tvr: string;
  appNombre: string;
  modo: string;
  simulado: boolean;
  fecha: string | Date | null;
};

const ALFANUMERICO = /^[A-Za-z0-9]{1,30}$/;

/**
 * Número de control único por transacción. Payworks lo exige alfanumérico, de
 * hasta 30 caracteres, y único por afiliación (Anexo V): un guion o un guion
 * bajo hacen que la DLL lo rechace con -1006.
 */
export function nuevoNumeroControl(fecha = new Date(), aleatorio = Math.random) {
  const p = (n: number) => String(n).padStart(2, "0");
  const sello =
    String(fecha.getUTCFullYear()).slice(2) +
    p(fecha.getUTCMonth() + 1) +
    p(fecha.getUTCDate()) +
    p(fecha.getUTCHours()) +
    p(fecha.getUTCMinutes()) +
    p(fecha.getUTCSeconds());
  let sufijo = "";
  while (sufijo.length < 8) sufijo += Math.floor(aleatorio() * 36).toString(36);
  return `TT${sello}${sufijo.toUpperCase()}`;
}

export function esNumeroControlValido(valor: unknown): valor is string {
  return typeof valor === "string" && ALFANUMERICO.test(valor);
}

export function esComandoBanorte(valor: unknown): valor is ComandoBanorte {
  return typeof valor === "string" && (COMANDOS_BANORTE as readonly string[]).includes(valor);
}

export function esResultadoPayw(valor: unknown): valor is ResultadoPayw {
  return typeof valor === "string" && (RESULTADOS_PAYW as readonly string[]).includes(valor);
}

export function estadoDeResultado(resultado: ResultadoPayw): EstadoTransaccion {
  switch (resultado) {
    case "A":
      return "aprobada";
    case "D":
      return "declinada";
    case "R":
      return "rechazada";
    case "T":
      return "sin_respuesta";
    default:
      return "error";
  }
}

/**
 * Solo "T" deja la duda de si el cobro pasó: ahí hay que preguntarle a
 * Payworks por el número de control. Los errores -2001 y -2009 parecen dudosos
 * pero la PinPad ya los reversa sola (Anexo VI), así que también son finales.
 */
export function hayQueVerificar(respuesta: Pick<RespuestaPuente, "resultado">) {
  return respuesta.resultado === "T";
}

/**
 * Crédito, débito o Amex a partir de lo que contesta el autorizador. Amex va
 * primero porque se liquida por su propio contrato aunque sea de crédito.
 */
export function tipoTarjetaDeRespuesta(tipo?: string, marca?: string): TipoTarjeta | null {
  const m = (marca ?? "").toUpperCase();
  if (m.includes("AMEX") || m.includes("AMERICAN")) return "amex";
  const t = (tipo ?? "").toUpperCase();
  if (t.startsWith("DEB")) return "debito";
  if (t.startsWith("CRED")) return "credito";
  return null;
}

/** Solo los últimos 4: aunque la DLL entregue más dígitos, no se guardan. */
export function soloUltimos4(valor?: string) {
  return (valor ?? "").replace(/\D/g, "").slice(-4);
}

// Errores de la PinPad (F, -2xxx) y de la DLL (E, -1xxx) del Anexo VI, en
// palabras para el cajero. Lo que no esté aquí se muestra con el texto que
// mande la terminal.
const MENSAJES_CODIGO: Record<string, string> = {
  "-1001": "No se pudo abrir la conexión con la terminal. Revisa que esté encendida y en la misma red.",
  "-1002": "La terminal tardó demasiado en contestar. Intenta de nuevo.",
  "-1003": "La terminal no responde. Revisa que esté encendida, en la misma red y en 'Esperando comando'.",
  "-1004": "La terminal contestó algo que no se entiende. Revisa la IP y el puerto en el puente de caja.",
  "-1005": "Falta el usuario o la contraseña de Payworks en el puente de caja.",
  "-1006": "Número de control inválido.",
  "-1009": "El puente de caja no tiene configurada la conexión con la terminal.",
  "-1011": "El puente de caja no tiene la IP o el puerto de la terminal.",
  "-1012": "No se pudo abrir la conexión con la terminal. Revisa la IP y el puerto.",
  "-1013": "No se pudo conectar con la terminal. Revisa la IP y el puerto.",
  "-1014": "Se cortó la comunicación con la terminal. Revisa la señal WiFi.",
  "-2001": "Sin comunicación con Banorte. La terminal reversó la operación sola; no se cobró.",
  "-2003": "La terminal no pudo comunicarse con Banorte. Revisa el Internet.",
  "-2004": "Banorte contestó algo inválido. Intenta de nuevo.",
  "-2006": "Se canceló en la terminal (el cliente canceló o se agotó el tiempo).",
  "-2008": "La terminal tiene poca señal. Acércala al módem.",
  "-2009": "El chip declinó la operación. La terminal la reversó sola; no se cobró.",
  "-2020": "Error en las llaves de la terminal. Hay que hacer la carga de llave.",
  "-2021": "Se agotó el tiempo para capturar el NIP.",
  "-2024": "Error al leer la tarjeta. Intenta de nuevo.",
  "-2026": "Error en el chip. Intenta de nuevo.",
  "-2027": "El NIP de la tarjeta está bloqueado.",
  "-2029": "La tarjeta está bloqueada.",
  "-2030": "Error al leer la tarjeta. Intenta de nuevo.",
  "-2031": "El chip no se puede leer o está bloqueado.",
  "-2032": "Se excedieron los intentos.",
  "-2033": "La terminal no acepta esta tarjeta.",
  "-2034": "El chip declinó la operación.",
  "-2036": "Se retiró la tarjeta antes de tiempo.",
  "-2037": "La tarjeta está vencida.",
  "-2039": "Inserta la tarjeta en lugar de deslizarla.",
  "PAYW-2019": "La terminal no tiene llave cargada. Hay que hacer la carga de llave.",
  "PAYW-3003": "Usuario o contraseña de Payworks inválidos. Revisa el puente de caja.",
  "PAYW-3006": "El usuario de Payworks está inactivo.",
  "PAYW-3007": "El usuario de Payworks no tiene permiso para cobrar.",
  "PAYW-3039": "Ese número de control ya se usó.",
};

function normalizarCodigo(codigo?: string) {
  return String(codigo ?? "")
    .trim()
    .toUpperCase()
    .replace(/[‐‑–—]/g, "-");
}

/** Mensaje para el cajero a partir del resultado de la terminal. */
export function mensajeParaCajero(r: Pick<RespuestaPuente, "resultado" | "codigo" | "texto">) {
  const codigo = normalizarCodigo(r.codigo);
  const texto = (r.texto ?? "").replace(/\+/g, " ").trim();
  if (r.resultado === "A") return "Aprobada";
  const conocido = MENSAJES_CODIGO[codigo] ?? MENSAJES_CODIGO[codigo.split(/\s/)[0]];
  if (conocido) return conocido;
  if (r.resultado === "D") return texto ? `Declinada: ${texto}` : "El banco declinó la tarjeta.";
  if (r.resultado === "R") return texto ? `Rechazada: ${texto}` : "Payworks rechazó la operación.";
  if (r.resultado === "T") return "Banorte no contestó. Se va a verificar si el cobro pasó.";
  return texto || (codigo ? `Error de la terminal (${codigo}).` : "Error de la terminal.");
}

const MAX_TEXTO = 200;
const recorta = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Limpia lo que reporta el navegador antes de guardarlo: solo campos conocidos,
 * recortados, y nunca más de 4 dígitos de la tarjeta.
 */
export function limpiarRespuesta(r: Partial<RespuestaPuente>) {
  return {
    resultado: esResultadoPayw(r.resultado) ? r.resultado : ("E" as ResultadoPayw),
    codigo: recorta(r.codigo, 40),
    texto: recorta(r.texto, MAX_TEXTO),
    autorizacion: recorta(r.autorizacion, 12),
    referencia: recorta(r.referencia, 30),
    afiliacion: recorta(r.afiliacion, 20),
    tipoTarjeta: recorta(r.tipoTarjeta, 20),
    marca: recorta(r.marca, 30),
    banco: recorta(r.banco, 60),
    bin: (r.bin ?? "").replace(/\D/g, "").slice(0, 8),
    ultimos4: soloUltimos4(r.ultimos4),
    modoEntrada: recorta(r.modoEntrada, 20),
    pinValidado: r.pinValidado === true,
    resultadoAutorizador: recorta(r.resultadoAutorizador, 10),
    aid: recorta(r.aid, 40),
    tvr: recorta(r.tvr, 20),
    appNombre: recorta(r.appPrefName || r.appLabel, 40),
    fechaSolicitud: recorta(r.fechaSolicitud, 30),
    fechaRespuesta: recorta(r.fechaRespuesta, 30),
    modo: (MODOS_PAYWORKS as readonly string[]).includes(String(r.modo)) ? (r.modo as ModoPayworks) : "",
    simulado: r.simulado === true,
  };
}

export type Verificacion = {
  tipo: string;
  referencia: string;
  ultimos4: string;
  monto: number;
  /** A abierta, C cerrada, P devolución parcial, R reversada, T devolución total, X indefinida. */
  estatus: string;
  resultado: ResultadoPayw | "";
  autorizacion: string;
  banco: string;
  marca: string;
  tipoTarjeta: string;
  numeroControl: string;
};

/**
 * La VERIFICACION regresa la transacción original como texto separado por "|"
 * (Anexo III, tabla 1):
 *   VTA | 333069450547 | 525678******4494 | 400.00 | C | A | 00 | 021302 |
 *   fecha | fecha | fecha | fecha | EXTRANJERA | MASTERCARD | CREDITO | **** |
 *   1E0300 | carlos2507180345
 * Devuelve null si el texto no tiene esa forma.
 */
export function leerVerificacion(texto?: string): Verificacion | null {
  const partes = String(texto ?? "").replace(/\+/g, " ").split("|").map((p) => p.trim());
  if (partes.length < 8 || !/^[A-Z]{3}$/.test(partes[0])) return null;
  const resultado = esResultadoPayw(partes[5]) ? partes[5] : "";
  return {
    tipo: partes[0],
    referencia: partes[1] ?? "",
    ultimos4: soloUltimos4(partes[2]),
    monto: Number(partes[3]) || 0,
    estatus: partes[4] ?? "",
    resultado,
    autorizacion: partes[7] ?? "",
    banco: partes[12] ?? "",
    marca: partes[13] ?? "",
    tipoTarjeta: partes[14] ?? "",
    numeroControl: partes[17] ?? "",
  };
}

/**
 * Estado real de una transacción según su verificación. Una venta aprobada
 * que después se reversó viene con resultado A pero estatus R.
 */
export function estadoDeVerificacion(v: Verificacion): EstadoTransaccion | null {
  if (v.estatus === "R") return "reversada";
  if (!v.resultado) return null;
  return estadoDeResultado(v.resultado);
}

export const ETIQUETA_COMANDO: Record<ComandoBanorte, string> = {
  OBTENER_LLAVE: "Carga de llave",
  VENTA: "Venta",
  CANCELACION: "Cancelación",
  DEVOLUCION: "Devolución",
  REVERSA: "Reversa",
  VERIFICACION: "Verificación",
};
