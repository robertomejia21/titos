"use client";

import { useEffect, useRef, useState } from "react";
import { BASCULA_UNIDAD, BASCULA_URL, leerPesoDeRespuesta, pesoBasculaEnKg } from "@/lib/bascula";

type Estado = "buscando" | "sin-bascula" | "leyendo";

const LECTURAS_ESTABLES = 3;

// Muestra el peso que reporta la báscula y avisa cuando se estabiliza.
// Si el puente no responde, no estorba: el cajero sigue capturando a mano.
export function PesoBascula({ onEstable }: { onEstable: (kg: string) => void }) {
  const [estado, setEstado] = useState<Estado>("buscando");
  const [peso, setPeso] = useState<number | null>(null);
  const [estable, setEstable] = useState(false);
  const ultimo = useRef<{ valor: number | null; veces: number }>({ valor: null, veces: 0 });
  const avisado = useRef<number | null>(null);
  const alEstable = useRef(onEstable);

  useEffect(() => {
    alEstable.current = onEstable;
  });

  useEffect(() => {
    let vivo = true;
    async function leer() {
      try {
        const res = await fetch(BASCULA_URL, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        const valor = res.ok ? leerPesoDeRespuesta(await res.text()) : null;
        if (!vivo) return;
        if (valor === null) throw new Error("respuesta sin peso");
        setEstado("leyendo");
        setPeso(valor);
        const previo = ultimo.current;
        ultimo.current = { valor, veces: previo.valor === valor ? previo.veces + 1 : 1 };
        const firme = valor > 0 && ultimo.current.veces >= LECTURAS_ESTABLES;
        setEstable(firme);
        if (firme && avisado.current !== valor) {
          avisado.current = valor;
          alEstable.current(pesoBasculaEnKg(valor).toFixed(3));
        }
        if (valor === 0) avisado.current = null;
      } catch {
        if (!vivo) return;
        setEstado("sin-bascula");
        setPeso(null);
        setEstable(false);
        ultimo.current = { valor: null, veces: 0 };
      }
    }
    leer();
    const id = setInterval(leer, 500);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (estado === "sin-bascula") {
    return (
      <p role="status" className="mb-3 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-sm text-black/70">
        Báscula no detectada. Captura el peso a mano.
      </p>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 rounded-2xl border px-4 py-4 text-center ${estable ? "border-emerald-300 bg-emerald-50" : "border-black/10 bg-black/[0.03]"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-black/60">{estado === "buscando" ? "Buscando báscula…" : "Peso en báscula"}</p>
      <p className="mt-1 text-5xl font-semibold tabular-nums leading-none">
        {peso === null ? "—" : pesoBasculaEnKg(peso).toFixed(3)}
        <span className="ml-2 text-xl font-medium text-black/60">kg</span>
      </p>
      {peso !== null && BASCULA_UNIDAD === "lb" ? <p className="mt-1 text-sm tabular-nums text-black/50">{peso.toFixed(2)} lb en la báscula</p> : null}
      <p className={`mt-2 text-sm font-medium ${estable ? "text-emerald-700" : "text-black/60"}`}>
        {peso === null ? "" : estable ? "Peso estable" : peso === 0 ? "Coloca el producto" : "Estabilizando…"}
      </p>
    </div>
  );
}
