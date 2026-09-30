"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/components/ui";
import { PesoBascula } from "@/components/sucursal/PesoBascula";
import { pesoEnKg } from "@/lib/equiposCaja";

const BOTON = "min-h-11 rounded-lg px-5 text-sm font-semibold transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]";

// Captura del peso de un producto que se vende por kilo. Con báscula, el peso llega solo y
// basta aceptar; sin báscula se escribe a mano. Todo va en kilos.
export function CapturaPeso({
  producto,
  valor,
  onValor,
  onConfirmar,
  onCerrar,
}: {
  producto: { nombre: string; precioVenta: number };
  valor: string;
  onValor: (v: string) => void;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const [bascula, setBascula] = useState({ conectada: false, estable: false });
  // Lo último que el cajero tecleó; solo cuenta como ajuste a mano mientras el campo siga igual.
  const [manual, setManual] = useState<string | null>(null);
  const aMano = manual !== null && manual === valor;
  const kg = pesoEnKg(valor);
  const total = kg === null ? null : kg * producto.precioVenta;
  // Con báscula se espera a que el peso se estabilice, salvo que el cajero lo ajuste a mano.
  const puedeAceptar = kg !== null && (!bascula.conectada || bascula.estable || aMano);

  // Enter acepta desde cualquier parte del modal (sobre un botón, lo activa el propio botón).
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest("button")) return;
      if (puedeAceptar) {
        e.preventDefault();
        onConfirmar();
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [puedeAceptar, onConfirmar]);

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Pesar ${producto.nombre}`}
      icon={ScanLine}
      sinBarra
      acciones={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON} text-titos-green-700 hover:bg-titos-green-100`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!puedeAceptar}
            className={`${BOTON} bg-titos-green-600 text-white hover:bg-titos-green-700 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Aceptar
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-black/60">
        Precio <span className="font-medium text-black/80">{formatMoney(producto.precioVenta)}</span> por kilo
      </p>

      <PesoBascula onEstable={onValor} onEstado={setBascula} />

      <div className="mt-4">
        <label htmlFor="peso-manual" className="mb-2 block text-sm font-medium text-black/70">
          {bascula.conectada ? "Ajustar a mano" : "Peso a cobrar"}
        </label>
        <div className="relative">
          <input
            id="peso-manual"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="0.000"
            value={valor}
            onChange={(e) => {
              setManual(e.target.value);
              onValor(e.target.value);
            }}
            className={`w-full rounded-xl border border-black/10 bg-white px-4 pr-14 font-semibold tabular-nums outline-none focus:border-titos-green-500 focus:ring-2 focus:ring-titos-green-100 ${bascula.conectada ? "py-2 text-lg" : "py-3 text-2xl"}`}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-medium text-black/40">kg</span>
        </div>
        {valor.trim() !== "" && kg === null ? <p className="mt-2 text-sm text-red-600">Escribe un peso mayor a cero, con hasta 3 decimales.</p> : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-4 rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3">
        <div>
          <p className="text-xs text-black/50">Cálculo</p>
          <p className="text-base tabular-nums text-black/75">{kg === null ? "—" : `${kg.toFixed(3)} kg × ${formatMoney(producto.precioVenta)}`}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-black/50">Total</p>
          <p className="text-3xl font-bold tabular-nums text-titos-green-900">{total === null ? "—" : formatMoney(total)}</p>
          <p className="text-[11px] text-black/40">antes de promociones</p>
        </div>
      </div>

      {bascula.conectada ? null : <p className="mt-2 text-xs text-black/45">Usa el peso neto. Si la báscula ya descontó la tara, no la restes otra vez.</p>}
    </Modal>
  );
}
