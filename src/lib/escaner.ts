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

/**
 * Algunos lectores anteponen o agregan una letra (o un identificador tipo "]E0") al código.
 * Devuelve el código sin ese añadido; si no hay nada que quitar, lo devuelve igual.
 * Solo se usa cuando el código tal cual no coincide con ningún producto.
 */
export function codigoSinLetraDeLector(valor: string): string {
  const v = valor.trim();
  const m =
    v.match(/^\][A-Za-z]\d(\d+)$/) ?? // identificador AIM: ]E0 + código
    v.match(/^[A-Za-z](\d+)[A-Za-z]$/) ?? // letra al inicio y al final
    v.match(/^[A-Za-z](\d+)$/) ?? // letra al inicio
    v.match(/^(\d+)[A-Za-z]$/); // letra al final
  return m ? m[1] : v;
}
