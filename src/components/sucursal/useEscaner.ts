"use client";

import { useEffect, useRef } from "react";
import { ESCANER_URL, leerCodigoDeRespuesta } from "@/lib/escaner";

// Consulta el escáner cada 0.6 s y avisa por cada código NUEVO (cambia el `ts`).
// El primer valor que se ve al abrir la pantalla es el de un escaneo anterior: no se procesa.
// Sin puente no estorba: el escáner por teclado sigue funcionando en el campo de búsqueda.
export function useEscaner(alCodigo: (codigo: string) => void) {
  const callback = useRef(alCodigo);

  useEffect(() => {
    callback.current = alCodigo;
  });

  useEffect(() => {
    let vivo = true;
    let iniciado = false;
    let ultimoTs: number | null = null;

    async function leer() {
      if (document.hidden) return;
      try {
        const res = await fetch(ESCANER_URL, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        const lectura = leerCodigoDeRespuesta(await res.text());
        if (!vivo) return;
        if (!iniciado) {
          iniciado = true;
          ultimoTs = lectura ? lectura.ts : 0;
          return;
        }
        if (lectura && lectura.ts !== ultimoTs) {
          ultimoTs = lectura.ts;
          callback.current(lectura.codigo);
        }
      } catch {
        // puente apagado o sin respuesta: se vuelve a intentar en el siguiente ciclo
      }
    }

    leer();
    const id = setInterval(leer, 600);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);
}
