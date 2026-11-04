"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, FormField, Input, Select } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { fechaEnZona, formatFechaHora } from "@/lib/zonasHorarias";
import { TIPO_EVENTO_RUTA_LABEL, type TipoEventoRuta } from "@/lib/logistica";
import { SkeletonTabla } from "@/components/Skeleton";

type Evento = { _id: string; fecha: string; salidaNombre: string; tipo: TipoEventoRuta; detalle: string; folio: string; porNombre: string; en: string };
type Salida = { _id: string; nombre: string; horaSalida: string };

const MANUALES: TipoEventoRuta[] = ["llegada", "parada_extra", "folio_devuelto", "merma", "regreso", "nota"];
const CLASE: Partial<Record<TipoEventoRuta, string>> = {
  incidencia: "text-red-700",
  folio_devuelto: "text-red-700",
  merma: "text-amber-700",
  parada_extra: "text-amber-700",
};

/**
 * Bitácora histórica de rutas: lo que el sistema registra solo (salidas,
 * escaneos, incidencias) más lo que se captura a mano (paradas extraordinarias,
 * llegadas, folios devueltos, mermas). Se consulta por día, rango o folio.
 */
export function BitacoraRutas() {
  const zona = useZonaHoraria();
  const hoy = fechaEnZona(new Date(), zona);
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [folio, setFolio] = useState("");
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [salidas, setSalidas] = useState<Salida[]>([]);
  const [nuevo, setNuevo] = useState({ salidaId: "", tipo: "parada_extra" as TipoEventoRuta, folio: "", detalle: "" });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const q = new URLSearchParams({ desde, hasta, ...(folio.trim() ? { folio: folio.trim() } : {}) });
    const res = await fetch(`/api/operacion/bitacora-rutas?${q}`);
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      setError(data.error || "No se pudo cargar la bitácora");
      return setEventos([]);
    }
    setError(null);
    setEventos(data);
  }, [desde, hasta, folio]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de la bitácora del día
    cargar();
    // Solo al montar: los filtros se aplican con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`/api/operacion/rol?fecha=${hoy}`)
      .then((r) => (r.ok ? r.json() : { salidas: [] }))
      .then((rol: { salidas?: Salida[] }) => {
        setSalidas(rol.salidas ?? []);
        setNuevo((n) => ({ ...n, salidaId: rol.salidas?.[0]?._id ?? "" }));
      });
  }, [hoy]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/operacion/bitacora-rutas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...nuevo, fecha: hoy }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo registrar");
    setNuevo({ ...nuevo, folio: "", detalle: "" });
    cargar();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold text-titos-green-900">Registrar en la bitácora de hoy</h2>
        <p className="mb-3 text-sm text-black/50">Paradas extraordinarias, llegadas, folios devueltos y mermas. Un folio devuelto o una merma también abren su incidencia.</p>
        {salidas.length === 0 ? (
          <p className="text-sm text-black/50">No hay salidas en el rol de hoy.</p>
        ) : (
          <form onSubmit={registrar} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Salida">
              <Select value={nuevo.salidaId} onChange={(e) => setNuevo({ ...nuevo, salidaId: e.target.value })}>
                {salidas.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.horaSalida} · {s.nombre}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Qué pasó">
              <Select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as TipoEventoRuta })}>
                {MANUALES.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_EVENTO_RUTA_LABEL[t]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Folio (opcional)">
              <Input value={nuevo.folio} onChange={(e) => setNuevo({ ...nuevo, folio: e.target.value })} placeholder="PED-…" />
            </FormField>
            <FormField label="Detalle">
              <Input value={nuevo.detalle} onChange={(e) => setNuevo({ ...nuevo, detalle: e.target.value })} placeholder="Paró en gasolinera 15 min" />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit">Registrar</Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <FormField label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </FormField>
          <FormField label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </FormField>
          <FormField label="Folio">
            <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Todos" />
          </FormField>
          <Button variant="ghost" onClick={cargar}>
            Consultar
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mb-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {eventos === null ? (
          <SkeletonTabla />
        ) : eventos.length === 0 ? (
          <EmptyState message="Sin movimientos en este rango." />
        ) : (
          <ol className="space-y-2 border-l-2 border-titos-green-100 pl-4">
            {eventos.map((e) => (
              <li key={e._id} className="text-sm">
                <p>
                  <strong className={CLASE[e.tipo] ?? ""}>{TIPO_EVENTO_RUTA_LABEL[e.tipo] ?? e.tipo}</strong>
                  <span className="text-black/50"> · {e.salidaNombre}</span>
                  {e.detalle ? <span className="text-black/70"> · {e.detalle}</span> : null}
                </p>
                <p className="text-xs text-black/45">
                  {formatFechaHora(e.en, zona)}
                  {e.porNombre ? ` · ${e.porNombre}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
