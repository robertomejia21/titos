"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

type Item = {
  productoId: string;
  nombreProducto: string;
  unidad: "pieza" | "kg";
  requierePesaje: boolean;
  cantidadSurtida: number | null;
};

export function RecepcionForm({ pedidoId, items }: { pedidoId: string; items: Item[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, { cantidad: string; peso: string }>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function actualizar(productoId: string, campo: "cantidad" | "peso", value: string) {
    setValores((prev) => ({
      ...prev,
      [productoId]: {
        cantidad: campo === "cantidad" ? value : (prev[productoId]?.cantidad ?? String(items.find((item) => item.productoId === productoId)?.cantidadSurtida ?? 0)),
        peso: campo === "peso" ? value : (prev[productoId]?.peso ?? ""),
      },
    }));
  }

  async function confirmar() {
    setError(null);
    if (items.some((item) => valores[item.productoId]?.cantidad === "")) {
      setError("Captura la cantidad recibida; usa cero si no llegó.");
      return;
    }
    setEnviando(true);

    const payload = items.map((item) => {
      const local = valores[item.productoId];
      const cantidad = local?.cantidad ? Number(local.cantidad) : item.cantidadSurtida ?? 0;
      const peso = local?.peso ? Number(local.peso) : undefined;
      return { productoId: item.productoId, cantidadRecibida: cantidad, pesoRecibidoKg: peso, notaRecepcion: notas[item.productoId] ?? "" };
    });

    try {
    const res = await fetch(`/api/pedidos/${pedidoId}/recibir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload }),
    });

    setEnviando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo registrar la recepción");
      return;
    }

    router.refresh();
    } catch { setError("No se pudo guardar la recepción. Revisa la conexión e intenta nuevamente."); }
    finally { setEnviando(false); }
  }

  return (
    <div className="mt-4 rounded-lg border border-titos-orange-100 bg-titos-orange-100/40 p-4">
      <h3 className="mb-3 font-semibold text-titos-green-900">Registrar recepción de mercancía</h3>
      <p className="mb-3 text-sm text-black/70">Captura lo que llegó. Confirmar cierra esta recepción; lo pedido y lo surtido se conservan.</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.productoId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40 font-medium">{item.nombreProducto}</span>
            <input
              type="number"
              step="any"
              aria-label={`Cantidad recibida de ${item.nombreProducto}`}
              min="0"
              placeholder={String(item.cantidadSurtida ?? 0)}
              defaultValue={item.cantidadSurtida ?? 0}
              onChange={(e) => actualizar(item.productoId, "cantidad", e.target.value)}
              className="w-24 rounded border border-black/10 px-2 py-1"
            />
            <span className="text-black/40">{item.unidad}</span>
            {item.requierePesaje ? (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`Peso real en kg de ${item.nombreProducto}`}
                  placeholder="Peso real (kg)"
                  onChange={(e) => actualizar(item.productoId, "peso", e.target.value)}
                  className="w-28 rounded border border-black/10 px-2 py-1"
                />
                <span className="text-xs text-titos-orange-700">requiere báscula</span>
              </>
            ) : null}
            <textarea aria-label={`Nota de recepción de ${item.nombreProducto}`} maxLength={1000}
              value={notas[item.productoId] ?? ""} onChange={(e) => setNotas((prev) => ({...prev, [item.productoId]: e.target.value}))}
              placeholder="Faltante, daño u observación" className="w-full rounded border border-black/20 p-2 sm:w-64 focus-visible:outline-2 focus-visible:outline-titos-green-600" />
          </div>
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
      <Button onClick={confirmar} disabled={enviando} className="mt-3" variant="secondary">
        {enviando ? "Guardando..." : "Confirmar recepción"}
      </Button>
    </div>
  );
}
