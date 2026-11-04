"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, FormField, Input, Select } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { TIPOS_INCIDENCIA, TIPO_INCIDENCIA_LABEL, type TipoIncidencia } from "@/lib/logistica";
import type { IncidenciaVista } from "@/lib/incidencias";

/**
 * Incidencias de cajas y folios con su conversación. El CEDIS las resuelve; la
 * tienda involucrada puede abrirlas y comentar.
 */
export function IncidenciasManager({ esMatriz, rutaFolio }: { esMatriz: boolean; rutaFolio: string }) {
  const zona = useZonaHoraria();
  const [filtro, setFiltro] = useState<"abierta" | "resuelta" | "todas">("abierta");
  const [lista, setLista] = useState<IncidenciaVista[] | null>(null);
  const [nueva, setNueva] = useState({ tipo: "caja_faltante" as TipoIncidencia, folio: "", cajaNumero: "", comentario: "" });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/incidencias${filtro === "todas" ? "" : `?estado=${filtro}`}`);
    setLista(res.ok ? await res.json() : []);
  }, [filtro]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al cambiar el filtro
    cargar();
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/incidencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nueva) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo registrar");
    setNueva({ ...nueva, folio: "", cajaNumero: "", comentario: "" });
    cargar();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">Registrar incidencia</h2>
        <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Qué pasó">
            <Select value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value as TipoIncidencia })}>
              {TIPOS_INCIDENCIA.filter((t) => t !== "sucursal_incorrecta").map((t) => (
                <option key={t} value={t}>
                  {TIPO_INCIDENCIA_LABEL[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Folio">
            <Input value={nueva.folio} onChange={(e) => setNueva({ ...nueva, folio: e.target.value })} placeholder="PED-…" />
          </FormField>
          <FormField label="Caja (opcional)">
            <Input value={nueva.cajaNumero} onChange={(e) => setNueva({ ...nueva, cajaNumero: e.target.value })} />
          </FormField>
          <FormField label="Comentario">
            <Input value={nueva.comentario} onChange={(e) => setNueva({ ...nueva, comentario: e.target.value })} placeholder="Llegó abierta, faltan 2 piezas" />
          </FormField>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Registrar</Button>
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-black/45">Si una caja llegó a la sucursal equivocada, escanea su QR: la incidencia se abre sola.</p>
          </div>
        </form>
      </Card>

      <div className="flex gap-1 border-b border-black/10">
        {(["abierta", "resuelta", "todas"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${filtro === f ? "border-titos-green-600 text-titos-green-700" : "border-transparent text-black/50"}`}
          >
            {f === "abierta" ? "Abiertas" : f === "resuelta" ? "Resueltas" : "Todas"}
          </button>
        ))}
      </div>

      {lista === null ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : lista.length === 0 ? (
        <EmptyState message="No hay incidencias en esta vista." />
      ) : (
        lista.map((i) => <TarjetaIncidencia key={i._id} incidencia={i} esMatriz={esMatriz} zona={zona} rutaFolio={rutaFolio} onCambio={cargar} />)
      )}
    </div>
  );
}

function TarjetaIncidencia({
  incidencia: i,
  esMatriz,
  zona,
  rutaFolio,
  onCambio,
}: {
  incidencia: IncidenciaVista;
  esMatriz: boolean;
  zona: string;
  rutaFolio: string;
  onCambio: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function mandar(resolver: boolean) {
    setError(null);
    const res = await fetch(`/api/incidencias/${i._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comentario: texto, resolver }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo guardar");
    setTexto("");
    onCambio();
  }

  return (
    <Card className={i.estado === "abierta" ? "border-l-4 border-l-red-500" : "opacity-80"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-titos-green-900">
            {TIPO_INCIDENCIA_LABEL[i.tipo as TipoIncidencia] ?? i.tipo}
            {i.folio ? (
              <>
                {" · "}
                {i.pedidoId ? (
                  <Link href={`${rutaFolio}${i.pedidoId}`} className="underline">
                    {i.folio}
                  </Link>
                ) : (
                  i.folio
                )}
              </>
            ) : null}
            {i.cajaNumero ? ` · caja ${i.cajaNumero}` : ""}
          </p>
          <p className="text-xs text-black/50">
            {i.sucursalDestino ? `Iba a ${i.sucursalDestino}` : ""}
            {i.sucursalDetecto ? ` · detectada en ${i.sucursalDetecto}` : ""} · {formatFechaHora(i.creadaEn, zona)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i.estado === "abierta" ? "bg-red-100 text-red-700" : "bg-titos-green-100 text-titos-green-700"}`}>
          {i.estado === "abierta" ? "Abierta" : "Resuelta"}
        </span>
      </div>
      <ol className="mt-3 space-y-1.5 border-l-2 border-black/5 pl-3 text-sm">
        {i.comentarios.map((c, n) => (
          <li key={n}>
            <p>{c.texto}</p>
            <p className="text-xs text-black/45">
              {c.porNombre} · {formatFechaHora(c.en, zona)}
            </p>
          </li>
        ))}
      </ol>
      {i.estado === "abierta" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={esMatriz ? "Comentario o cómo se resolvió" : "Comentario"} className="min-w-0 flex-1" aria-label="Comentario" />
          <Button variant="ghost" onClick={() => mandar(false)} disabled={!texto.trim()}>
            Comentar
          </Button>
          {esMatriz ? (
            <Button onClick={() => mandar(true)} disabled={!texto.trim()}>
              Marcar resuelta
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}
