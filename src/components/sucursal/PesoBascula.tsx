"use client";

import { useEffect, useRef, useState } from "react";
import { BASCULA_UNIDAD, BASCULA_URL, leerPesoDeRespuesta, pesoBasculaEnKg } from "@/lib/bascula";

type Estado = "buscando" | "sin-bascula" | "leyendo";

const LECTURAS_ESTABLES = 3;

// Muestra el peso que reporta la báscula (siempre en kg) y avisa cuando se estabiliza.
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
      <div role="status" className="flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2.5 text-sm text-black/60">
        <span className="h-2 w-2 shrink-0 rounded-full bg-black/25" />
        Sin báscula conectada. Escribe el peso abajo.
      </div>
    );
  }

  const cero = peso === 0;
  const texto = peso === null ? "Buscando báscula…" : estable ? "Peso estable" : cero ? "Coloca el producto en la báscula" : "Estabilizando…";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 text-center transition-colors ${estable ? "border-titos-green-500/40 bg-titos-green-100" : "border-black/10 bg-black/[0.03]"}`}
    >
      <p className={`inline-flex items-center gap-2 text-sm font-medium ${estable ? "text-titos-green-700" : "text-black/55"}`}>
        <span className={`h-2 w-2 rounded-full ${estable ? "bg-titos-green-500" : "animate-pulse bg-black/30"}`} />
        {texto}
      </p>
      <p className="mt-0.5 text-5xl font-semibold leading-none tabular-nums text-titos-green-900">
        {peso === null ? "—" : pesoBasculaEnKg(peso).toFixed(3)}
        <span className="ml-2 text-2xl font-medium text-black/45">kg</span>
      </p>
      {peso !== null && BASCULA_UNIDAD === "lb" ? <p className="mt-2 text-sm tabular-nums text-black/45">{peso.toFixed(2)} lb en la báscula</p> : null}
    </div>
  );
}
