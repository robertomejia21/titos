// Lectura del puente local de la báscula (http://localhost:8090/peso).
// Contrato del puente (confirmado por Marce): GET /peso →
//   200 {"ok": true, "peso_lb": 2.77, "crudo": "002.77"}
//   502 {"ok": false, "error": "..."} si la báscula no responde o el puerto está ocupado.
// Por tolerancia también se acepta JSON con `peso`/`weight`/`valor` o texto plano.
import { libraAKg } from "@/lib/equiposCaja";

export const BASCULA_URL = process.env.NEXT_PUBLIC_BASCULA_URL || "http://localhost:8090/peso";
// El protocolo no manda unidad; hoy la báscula de Titos está en libras.
export const BASCULA_UNIDAD: "kg" | "lb" = process.env.NEXT_PUBLIC_BASCULA_UNIDAD === "kg" ? "kg" : "lb";

// El sistema siempre trabaja en kilos: lo que reporta la báscula se convierte aquí, según su unidad.
export function pesoBasculaEnKg(valor: number): number {
  return BASCULA_UNIDAD === "lb" ? libraAKg(valor) : Math.round(valor * 1000) / 1000;
}

export function leerPesoDeRespuesta(texto: string): number | null {
  let crudo: unknown = texto;
  try {
    const json = JSON.parse(texto);
    if (json?.ok === false) return null;
    crudo = typeof json === "object" && json !== null ? (json.peso_lb ?? json.peso ?? json.weight ?? json.valor) : json;
  } catch {}
  const limpio = String(crudo ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}
