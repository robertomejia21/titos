import { BASCULA_URL } from "@/lib/bascula";

// Lectura del escáner de código de barras desde el puente local.
// GET /escaner → 200 {"ok": true, "codigo": "...", "ts": 1759199999.1}
//                502 {"ok": false, ...} mientras no se haya escaneado nada.
export const ESCANER_URL = process.env.NEXT_PUBLIC_ESCANER_URL || BASCULA_URL.replace(/\/peso$/, "/escaner");

export type LecturaEscaner = { codigo: string; ts: number };

export function leerCodigoDeRespuesta(texto: string): LecturaEscaner | null {
  try {
    const json = JSON.parse(texto);
    if (!json || json.ok === false) return null;
    const codigo = typeof json.codigo === "string" ? json.codigo.replace(/[\r\n]+/g, "").trim() : "";
    const ts = Number(json.ts);
    return codigo && Number.isFinite(ts) ? { codigo, ts } : null;
  } catch {
    return null;
  }
}
