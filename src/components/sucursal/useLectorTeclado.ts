"use client";

import { useEffect, useRef, type RefObject } from "react";

// Un lector USB "tipo teclado" escribe el código muy rápido (unos ms entre tecla y tecla) y
// termina con Enter. Una persona tarda bastante más entre teclas.
const MS_ENTRE_TECLAS = 50;
const MS_ANTES_DEL_ENTER = 100;
const MIN_CARACTERES = 4;

function esEditable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes(el.type);
}

// Cambia el valor de un input controlado por React y avisa como si se hubiera tecleado,
// para que su onChange actualice el estado.
function ponerValor(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Hace que lo que escribe el lector de códigos (USB tipo teclado) siempre llegue a la casilla de
 * búsqueda del punto de venta, aunque el cursor esté en otro lado:
 * - Si el cursor no está en ninguna casilla (se dio clic en la tabla, un botón, etc.), la primera
 *   tecla regresa el cursor a la casilla de búsqueda y el resto del código cae ahí.
 * - Si está en otra casilla (cantidad de un renglón, buscador por nombre…) y llega una ráfaga de
 *   lector terminada en Enter, se deshace lo que se escribió en esa casilla y se manda el código a
 *   `alEscanear`.
 * Con una ventana abierta (cobro, pesado, cancelación…) no hace nada.
 */
export function useLectorTeclado(casilla: RefObject<HTMLInputElement | null>, alEscanear: (codigo: string) => void) {
  const callback = useRef(alEscanear);
  useEffect(() => {
    callback.current = alEscanear;
  });

  useEffect(() => {
    let rafaga: { campo: HTMLElement; antes: string; texto: string; ultima: number } | null = null;

    function alTeclear(e: KeyboardEvent) {
      const busqueda = casilla.current;
      if (!busqueda || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector("[data-modal]")) {
        rafaga = null;
        return;
      }
      const activo = document.activeElement;
      if (activo === busqueda) {
        rafaga = null;
        return;
      }
      const ahora = performance.now();

      if (esEditable(activo)) {
        if (e.key === "Enter") {
          const r = rafaga;
          rafaga = null;
          if (r && r.campo === activo && r.texto.length >= MIN_CARACTERES && ahora - r.ultima <= MS_ANTES_DEL_ENTER) {
            e.preventDefault();
            e.stopPropagation();
            if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) ponerValor(activo, r.antes);
            busqueda.focus();
            callback.current(r.texto);
          }
          return;
        }
        if (e.key.length !== 1) {
          rafaga = null;
          return;
        }
        const sigue = rafaga && rafaga.campo === activo && ahora - rafaga.ultima <= MS_ENTRE_TECLAS;
        if (sigue && rafaga) {
          rafaga.texto += e.key;
          rafaga.ultima = ahora;
        } else {
          const valor = activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement ? activo.value : "";
          rafaga = { campo: activo, antes: valor, texto: e.key, ultima: ahora };
        }
        return;
      }

      // Cursor fuera de las casillas: una tecla imprimible regresa el cursor a la búsqueda.
      // (El espacio no, para no robarle el espacio a un botón con el foco.)
      rafaga = null;
      if (e.key.length !== 1 || e.key === " ") return;
      e.preventDefault();
      busqueda.focus();
      // El valor se pone ya en la casilla (no solo en el estado) para que las siguientes teclas
      // del lector, que llegan en milisegundos, se agreguen detrás y no se pierda la primera.
      ponerValor(busqueda, e.key);
    }

    window.addEventListener("keydown", alTeclear, true);
    return () => window.removeEventListener("keydown", alTeclear, true);
  }, [casilla]);
}
