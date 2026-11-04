"use client";

import { useEffect, useState } from "react";
import { Button, Card, EmptyState, FormField, Input } from "@/components/ui";
import { ESTADO_TEMPORADA_LABEL, textoMesDia, type EstadoTemporada } from "@/lib/temporadas";
import { SkeletonTabla } from "@/components/Skeleton";

type Fila = { _id: string; sku: string; nombre: string; existenciaMatriz: number; inicio: string; fin: string; estado: EstadoTemporada };
type Opcion = { _id: string; nombre: string; sku: string };

const CLASE: Record<EstadoTemporada, string> = {
  sin_temporada: "bg-black/5 text-black/60",
  en_temporada: "bg-titos-green-100 text-titos-green-700",
  fuera_con_existencia: "bg-amber-100 text-amber-800",
  bloqueado: "bg-red-100 text-red-700",
};

/** "2026-12-15" → "12-15": de la fecha solo importan mes y día. */
const aMesDia = (fecha: string) => fecha.slice(5, 10);
const aFecha = (mmdd: string) => (mmdd ? `2026-${mmdd}` : "");

/**
 * Productos de temporada: dentro de sus fechas se manejan normal; fuera, al
 * agotarse en el CEDIS se bloquean para pedido y compra, y se reactivan solos.
 */
export function TemporadasManager({ editable }: { editable: boolean }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [elegido, setElegido] = useState<Opcion | null>(null);
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function aplicar(data: { productos?: Fila[] }) {
    setFilas(data.productos ?? []);
  }

  useEffect(() => {
    fetch("/api/operacion/temporadas")
      .then((r) => (r.ok ? r.json() : { productos: [] }))
      .then(aplicar);
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2 || elegido) return;
    const t = setTimeout(() => {
      fetch(`/api/productos?page=1&pageSize=8&q=${encodeURIComponent(busqueda.trim())}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: Opcion[] }) => setOpciones(d.items ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, elegido]);

  async function guardar(cuerpo: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/operacion/temporadas", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo guardar");
    aplicar(data);
    setElegido(null);
    setBusqueda("");
    setInicio("");
    setFin("");
  }

  return (
    <Card>
      <h2 className="font-semibold text-titos-green-900">Productos de temporada</h2>
      <p className="mb-3 text-sm text-black/50">
        Fuera de su temporada se vende lo que queda; al agotarse en el CEDIS se bloquea para que las tiendas no lo pidan y no se vuelva a comprar. El día que arranca se reactiva solo y se avisa por WhatsApp a Compras y al grupo de faltantes de su categoría.
      </p>

      {editable ? (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-black/2 p-3 sm:grid-cols-4">
          <FormField label="Producto" className="relative sm:col-span-2">
            <Input
              value={elegido ? `${elegido.nombre} · ${elegido.sku}` : busqueda}
              onChange={(e) => {
                setElegido(null);
                setBusqueda(e.target.value);
              }}
              placeholder="Busca por nombre o SKU"
            />
            {!elegido && opciones.length && busqueda.trim().length >= 2 ? (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white shadow">
                {opciones.map((o) => (
                  <li key={o._id}>
                    <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-titos-green-100" onClick={() => setElegido(o)}>
                      {o.nombre} <span className="text-black/40">· {o.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </FormField>
          <FormField label="Inicia (mes y día)">
            <Input type="date" value={aFecha(inicio)} onChange={(e) => setInicio(aMesDia(e.target.value))} />
          </FormField>
          <FormField label="Termina (mes y día)">
            <Input type="date" value={aFecha(fin)} onChange={(e) => setFin(aMesDia(e.target.value))} />
          </FormField>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
            <Button disabled={!elegido || !inicio || !fin} onClick={() => elegido && guardar({ productoId: elegido._id, inicio, fin })}>
              Marcar como de temporada
            </Button>
            <span className="text-xs text-black/45">El año no importa: se repite cada año. Puede cruzar el año (15 nov → 6 ene).</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {filas === null ? (
        <SkeletonTabla />
      ) : filas.length === 0 ? (
        <EmptyState message="Ningún producto está marcado como de temporada." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs text-black/50">
                <th className="px-2 py-1.5 font-medium">Producto</th>
                <th className="px-2 py-1.5 font-medium">Temporada</th>
                <th className="px-2 py-1.5 text-right font-medium">En CEDIS</th>
                <th className="px-2 py-1.5 font-medium">Hoy</th>
                {editable ? <th className="px-2 py-1.5" /> : null}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f._id} className="border-b border-black/5">
                  <td className="px-2 py-1.5 font-medium">
                    {f.nombre} <span className="text-xs text-black/40">{f.sku}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {textoMesDia(f.inicio)} → {textoMesDia(f.fin)}
                  </td>
                  <td className="px-2 py-1.5 text-right">{f.existenciaMatriz}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASE[f.estado]}`}>{ESTADO_TEMPORADA_LABEL[f.estado]}</span>
                  </td>
                  {editable ? (
                    <td className="px-2 py-1.5 text-right">
                      <button className="text-xs text-red-600" onClick={() => guardar({ productoId: f._id, activa: false })}>
                        Quitar temporada
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
