// Cliente del PAC SW sapien (SmarterWeb). Es la única puerta al timbrado:
// nadie más debe hablar con services.sw.com.mx directamente.
//
// Contrato tomado del SDK oficial (github.com/lunasoft/sw-sdk-nodejs):
//   auth      POST {SW_URL}/v2/security/authenticate        body JSON {user, password}
//   timbrado  POST {SW_URL}/v4/cfdi33/issue/json/v4         Content-Type application/jsontoxml
//   cancelar  POST {SW_URL}/cfdi33/cancel/{rfc}/{uuid}/{motivo}/{folioSustitucion}
//   saldo     GET  {SW_API_URL}/management/v2/api/users/balance
//
// El path dice /cfdi33 por compatibilidad; el mismo endpoint recibe CFDI 4.0.
// "issue" quiere decir que SW sella con el CSD cargado en la cuenta y timbra en
// una sola llamada, por eso el JSON va con Sello, NoCertificado y Certificado
// vacíos: los llena el PAC. Si el CSD no está cargado en la cuenta de SW, el
// timbrado falla ahí, no aquí.

import type { MotivoCancelacion } from "./facturas";

export type CfdiJson = Record<string, unknown>;

/** Envoltura común de las respuestas de SW, tanto de éxito como de error. */
type RespuestaSw = {
  status?: string;
  message?: string;
  messageDetail?: string;
  data?: Record<string, unknown> & { token?: string; expires_in?: number };
};

export type RespuestaTimbrado = {
  cfdi: string; // XML timbrado. Este es el documento con valor fiscal.
  uuid: string;
  fechaTimbrado: string;
  selloSAT: string;
  selloCFDI: string;
  noCertificadoSAT: string;
  cadenaOriginalSAT: string;
  qrCode: string; // base64 del QR de verificación, solo si se pidió PDF
};

/** Error del PAC. `codigo` es el código del SAT (CFDI40xxx) cuando lo hay. */
export class ErrorSw extends Error {
  readonly codigo: string;
  readonly detalle: string;
  constructor(message: string, codigo = "", detalle = "") {
    super(message);
    this.name = "ErrorSw";
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

function url() {
  return (process.env.SW_URL || "https://services.test.sw.com.mx").replace(/\/+$/, "");
}

function urlApi() {
  return (process.env.SW_API_URL || "https://api.test.sw.com.mx").replace(/\/+$/, "");
}

/** True cuando apuntamos a producción: el timbre cuesta y es real ante el SAT. */
export function esProduccion() {
  return !url().includes(".test.");
}

export function swConfigurado() {
  return Boolean(process.env.SW_TOKEN || (process.env.SW_USER && process.env.SW_PASSWORD));
}

/**
 * Candado de emisión. Timbrar consume un timbre y crea un CFDI real ante el
 * SAT que ya no se borra, solo se cancela; mientras el mapper no esté revisado
 * el sistema no debe poder emitir aunque alguien llame a timbrar() por error.
 * Se abre poniendo SW_TIMBRADO_HABILITADO=1 en el entorno.
 */
export function timbradoHabilitado() {
  return process.env.SW_TIMBRADO_HABILITADO === "1";
}

// El token de SW dura horas y cada autenticación consume una llamada, así que
// se guarda en memoria del proceso. No se persiste: es una credencial viva y
// un reinicio de Vercel debe poder pedir otro sin estado previo.
let tokenCache: { valor: string; expira: number } | null = null;

/** Descarta el token guardado. Útil tras un 401 o al rotar credenciales. */
export function olvidarToken() {
  tokenCache = null;
}

async function pedirToken(): Promise<string> {
  // SW permite emitir un token permanente desde su portal. Si está configurado
  // se usa tal cual y nunca se llama al servicio de autenticación.
  if (process.env.SW_TOKEN) return process.env.SW_TOKEN;

  const user = process.env.SW_USER;
  const password = process.env.SW_PASSWORD;
  if (!user || !password)
    throw new ErrorSw(
      "Faltan credenciales de SW. Configura SW_USER y SW_PASSWORD (o SW_TOKEN).",
    );

  const res = await fetch(`${url()}/v2/security/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password }),
    cache: "no-store",
  });

  const cuerpo = await res.text();
  let json: RespuestaSw | null = null;
  try {
    json = JSON.parse(cuerpo) as RespuestaSw;
  } catch {
    throw new ErrorSw(
      `SW respondió ${res.status} sin JSON al autenticar.`,
      String(res.status),
      cuerpo.slice(0, 500),
    );
  }

  if (!res.ok || json?.status !== "success" || !json?.data?.token)
    throw new ErrorSw(
      json?.message || `No se pudo autenticar con SW (HTTP ${res.status}).`,
      json?.status || String(res.status),
      json?.messageDetail || "",
    );

  // expires_in viene en segundos desde época. Se renueva cinco minutos antes
  // para que una petición larga no muera con el token vencido a medio camino.
  const expiraEn = Number(json.data?.expires_in);
  const expira = Number.isFinite(expiraEn)
    ? expiraEn * 1000 - 5 * 60 * 1000
    : Date.now() + 55 * 60 * 1000;

  const valor = json.data!.token!;
  tokenCache = { valor, expira };
  return valor;
}

/** Token vigente, reutilizando el de memoria mientras sirva. */
export async function token(): Promise<string> {
  if (tokenCache && tokenCache.expira > Date.now()) return tokenCache.valor;
  return pedirToken();
}

/**
 * Lee la respuesta de SW y levanta ErrorSw si el PAC rechazó la petición.
 * SW contesta HTTP 200 con `status: "error"` en varios rechazos, por eso no
 * basta con mirar el código de estado.
 */
async function leerRespuesta(res: Response, que: string) {
  const cuerpo = await res.text();
  let json: RespuestaSw | null = null;
  try {
    json = JSON.parse(cuerpo) as RespuestaSw;
  } catch {
    throw new ErrorSw(
      `SW respondió ${res.status} sin JSON al ${que}.`,
      String(res.status),
      cuerpo.slice(0, 500),
    );
  }
  if (!res.ok || json?.status === "error")
    throw new ErrorSw(
      json?.message || `SW rechazó la petición al ${que} (HTTP ${res.status}).`,
      json?.messageDetail?.match(/CFDI\d{5}/)?.[0] || json?.status || String(res.status),
      json?.messageDetail || "",
    );
  return json as RespuestaSw;
}

/**
 * Sella y timbra un CFDI 4.0 enviado como JSON.
 *
 * @param cfdi   Comprobante con Sello, NoCertificado y Certificado vacíos.
 * @param opts.pdf     pide también la representación impresa y el QR.
 * @param opts.email   copias del XML y PDF que manda SW.
 * @param opts.customId identificador propio para que SW rechace un duplicado.
 *                      Mandar siempre el folio: es lo que evita timbrar dos
 *                      veces la misma factura si el request se reintenta.
 */
export async function timbrar(
  cfdi: CfdiJson,
  opts: { pdf?: boolean; email?: string[]; customId?: string } = {},
): Promise<RespuestaTimbrado> {
  if (!timbradoHabilitado())
    throw new ErrorSw(
      "El timbrado está deshabilitado. Ponlo en SW_TIMBRADO_HABILITADO=1 cuando el CFDI esté revisado.",
      "TIMBRADO_DESHABILITADO",
    );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    "Content-Type": "application/jsontoxml",
  };
  if (opts.pdf) headers.extra = "pdf";
  if (opts.customId) headers.customid = opts.customId;
  if (opts.email?.length) headers.email = opts.email.join(",");

  const res = await fetch(`${url()}/v4/cfdi33/issue/json/v4`, {
    method: "POST",
    headers,
    body: JSON.stringify(cfdi),
    cache: "no-store",
  });

  // Un 401 casi siempre es token vencido antes de tiempo. Se reintenta una vez
  // con token nuevo; si vuelve a fallar, es credencial mala y debe verse.
  if (res.status === 401 && !process.env.SW_TOKEN) {
    olvidarToken();
    const reintento = await fetch(`${url()}/v4/cfdi33/issue/json/v4`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(cfdi),
      cache: "no-store",
    });
    return (await leerRespuesta(reintento, "timbrar")).data as unknown as RespuestaTimbrado;
  }

  return (await leerRespuesta(res, "timbrar")).data as unknown as RespuestaTimbrado;
}

/**
 * Cancela ante el SAT un CFDI ya timbrado.
 * `folioSustitucion` es el UUID que lo reemplaza y solo aplica al motivo 01.
 */
export async function cancelar(
  rfcEmisor: string,
  uuid: string,
  motivo: MotivoCancelacion,
  folioSustitucion = "",
) {
  if (motivo === "01" && !folioSustitucion)
    throw new ErrorSw("El motivo 01 exige el UUID de la factura que sustituye.");

  const res = await fetch(
    `${url()}/cfdi33/cancel/${encodeURIComponent(rfcEmisor)}/${encodeURIComponent(uuid)}/${motivo}/${encodeURIComponent(folioSustitucion)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}` },
      cache: "no-store",
    },
  );
  return (await leerRespuesta(res, "cancelar")).data;
}

/** Timbres disponibles en la cuenta. Sirve para avisar antes de quedarse sin. */
export async function saldo() {
  const res = await fetch(`${urlApi()}/management/v2/api/users/balance`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  return (await leerRespuesta(res, "consultar saldo")).data;
}
