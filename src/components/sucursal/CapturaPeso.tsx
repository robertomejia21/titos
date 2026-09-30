"use client";

import { ScanLine } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button, formatMoney } from "@/components/ui";
import { PesoBascula } from "@/components/sucursal/PesoBascula";
import { kgALibras, pesoEnKg } from "@/lib/equiposCaja";

type Unidad = "kg" | "lb";

const UNIDADES: { valor: Unidad; etiqueta: string }[] = [
  { valor: "kg", etiqueta: "Kilos" },
  { valor: "lb", etiqueta: "Libras" },
];

// Captura del peso de un producto que se vende por kilo. El peso llega solo de la
// báscula (en kg) o se escribe a mano en kilos o libras; el sistema siempre cobra en kg.
export function CapturaPeso({
  producto,
  valor,
  onValor,
  unidad,
  onUnidad,
  onConfirmar,
  onCerrar,
}: {
  producto: { nombre: string; precioVenta: number };
  valor: string;
  onValor: (v: string) => void;
  unidad: Unidad;
  onUnidad: (u: Unidad) => void;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const kg = pesoEnKg(valor, unidad);
  const total = kg === null ? null : kg * producto.precioVenta;

  // Al cambiar de unidad se conserva el mismo peso, solo cambia cómo se escribe.
  function cambiarUnidad(nueva: Unidad) {
    if (nueva === unidad) return;
    if (kg !== null) onValor(nueva === "kg" ? kg.toFixed(3) : kgALibras(kg).toFixed(2));
    onUnidad(nueva);
  }

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Pesar ${producto.nombre}`}
      icon={ScanLine}
      sinBarra
      acciones={
        <>
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={kg === null}>
            Aceptar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-black/60">
        Precio <span className="font-medium text-black/80">{formatMoney(producto.precioVenta)}</span> por kilo
      </p>

      <PesoBascula onEstable={(peso) => { onValor(peso); onUnidad("kg"); }} />

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="peso-manual" className="text-sm font-medium text-black/70">
            Peso a cobrar
          </label>
          <div role="radiogroup" aria-label="Unidad del peso" className="inline-flex rounded-xl bg-black/[0.06] p-1">
            {UNIDADES.map((u) => (
              <button
                key={u.valor}
                type="button"
                role="radio"
                aria-checked={unidad === u.valor}
                onClick={() => cambiarUnidad(u.valor)}
                className={`min-h-9 rounded-lg px-4 text-sm font-medium transition-colors ${unidad === u.valor ? "bg-white text-titos-green-900 shadow-sm" : "text-black/55 hover:text-black/80"}`}
              >
                {u.etiqueta}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <input
            id="peso-manual"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="0.000"
            value={valor}
            onChange={(e) => onValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && kg !== null) onConfirmar();
            }}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 pr-14 text-2xl font-semibold tabular-nums outline-none focus:border-titos-green-500 focus:ring-2 focus:ring-titos-green-100"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-medium text-black/40">{unidad}</span>
        </div>
        {valor.trim() !== "" && kg === null ? <p className="mt-2 text-sm text-red-600">Escribe un peso mayor a cero, con hasta 3 decimales.</p> : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-4 rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3">
        <div>
          <p className="text-xs text-black/50">Cálculo</p>
          <p className="text-base tabular-nums text-black/75">
            {kg === null ? "—" : `${kg.toFixed(3)} kg × ${formatMoney(producto.precioVenta)}`}
          </p>
          {kg !== null && unidad === "lb" ? <p className="text-xs tabular-nums text-black/45">{valor} lb = {kg.toFixed(3)} kg</p> : null}
        </div>
        <div className="text-right">
          <p className="text-xs text-black/50">Total</p>
          <p className="text-3xl font-bold tabular-nums text-titos-green-900">{total === null ? "—" : formatMoney(total)}</p>
          <p className="text-[11px] text-black/40">antes de promociones</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-black/45">Usa el peso neto. Si la báscula ya descontó la tara, no la restes otra vez.</p>
    </Modal>
  );
}
