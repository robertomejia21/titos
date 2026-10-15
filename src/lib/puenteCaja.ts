import type { RespuestaPuente, SolicitudPuente } from "@/lib/banorte";

// Cliente HTTP del puente de caja (programa local en la PC de caja, ver
// puente-caja/README.md). Corre en el navegador: la página de Titos le habla a
// http://localhost, que es la PC donde está sentado el cajero.
export const PUENTE_CAJA_URL = (process.env.NEXT_PUBLIC_PUENTE_CAJA_URL || "http://localhost:8091").replace(/\/$/, "");

export type EstadoPuente = {
  ok: boolean;
  version?: string;
  pinpad?: "dll" | "simulador";
  dllCargada?: boolean;
  ip?: string;
  puerto?: string;
  modo?: string;
  ocupado?: boolean;
  credenciales?: boolean;
};

type Fetch = typeof fetch;

export class ErrorPuente extends Error {
  /** El puente no contestó (no está corriendo, o se cortó la conexión). */
  constructor(message: string, public sinConexion = false, public status = 0) {
    super(message);
  }
}

async function leer(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new ErrorPuente(json?.error || `El puente de caja contestó ${res.status}`, false, res.status);
  }
  return json;
}

export async function estadoPuente(f: Fetch = fetch, url = PUENTE_CAJA_URL): Promise<EstadoPuente> {
  try {
    const res = await f(`${url}/estado`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return (await leer(res)) as EstadoPuente;
  } catch (err) {
    if (err instanceof ErrorPuente) throw err;
    throw new ErrorPuente("El puente de caja no responde. ¿Está abierto el programa en esta PC?", true);
  }
}

/**
 * Manda el comando a la terminal y espera la respuesta. Tarda lo que el
 * cliente se tarde en acercar la tarjeta y poner su NIP (hasta ~90 s).
 */
export async function ejecutarEnPuente(
  solicitud: SolicitudPuente,
  f: Fetch = fetch,
  url = PUENTE_CAJA_URL,
  timeoutMs = 150_000
): Promise<RespuestaPuente> {
  let res: Response;
  try {
    res = await f(`${url}/banorte/transaccion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solicitud),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ErrorPuente("Se perdió la comunicación con el puente de caja", true);
  }
  return (await leer(res)) as RespuestaPuente;
}

/** La respuesta que el puente guardó para ese número de control, si ya la tiene. */
export async function resultadoEnPuente(numeroControl: string, f: Fetch = fetch, url = PUENTE_CAJA_URL): Promise<RespuestaPuente | null> {
  try {
    const res = await f(`${url}/banorte/resultado/${encodeURIComponent(numeroControl)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) return null;
    return (await leer(res)) as RespuestaPuente;
  } catch {
    return null;
  }
}
