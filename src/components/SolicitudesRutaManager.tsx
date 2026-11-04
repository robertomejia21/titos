"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, FormField, Input, Select } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { fechaEnZona, formatFechaHora, sumarDias } from "@/lib/zonasHorarias";
import type { SolicitudVista } from "@/lib/solicitudesRuta";
import { SkeletonTabla } from "@/components/Skeleton";

const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Por confirmar", clase: "bg-amber-100 text-amber-800" },
  reprogramada: { texto: "Horario propuesto", clase: "bg-sky-100 text-sky-800" },
  confirmada: { texto: "Confirmada", clase: "bg-titos-green-100 text-titos-green-700" },
  entregada: { texto: "Entregada", clase: "bg-black/5 text-black/60" },
  cancelada: { texto: "Cancelada", clase: "bg-black/5 text-black/40" },
};
const FRIO: Record<string, string> = { ninguno: "Sin frío", refrigerado: "Refrigerado", congelado: "Congelado" };

/**
 * Solicitudes de ruta: la tienda pide una entrega con datos completos y el
 * CEDIS la confirma en una salida del rol o propone otro horario.
 */
export function SolicitudesRutaManager({ esMatriz }: { esMatriz: boolean }) {
  const zona = useZonaHoraria();
  const manana = sumarDias(fechaEnZona(new Date(), zona), 1);
  const [lista, setLista] = useState<SolicitudVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState({ folioPedido: "", direccion: "", zona: "", fecha: manana, horaDesde: "09:00", horaHasta: "12:00", frio: "ninguno", notas: "" });

  const cargar = useCallback(async () => {
    const res = await fetch("/api/solicitudes-ruta");
    setLista(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de solicitudes
    cargar();
  }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/solicitudes-ruta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nueva) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo mandar la solicitud");
    setNueva({ ...nueva, folioPedido: "", direccion: "", zona: "", notas: "" });
    cargar();
  }

  return (
    <div className="space-y-4">
      {!esMatriz ? (
        <Card>
          <h2 className="mb-3 font-semibold text-titos-green-900">Pedir una entrega</h2>
          <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Dirección de entrega" className="sm:col-span-2">
              <Input value={nueva.direccion} onChange={(e) => setNueva({ ...nueva, direccion: e.target.value })} placeholder="Calle, número, colonia" />
            </FormField>
            <FormField label="Zona">
              <Input value={nueva.zona} onChange={(e) => setNueva({ ...nueva, zona: e.target.value })} placeholder="Centro, Progreso norte…" />
            </FormField>
            <FormField label="Pedido (opcional)">
              <Input value={nueva.folioPedido} onChange={(e) => setNueva({ ...nueva, folioPedido: e.target.value })} placeholder="PED-…" />
            </FormField>
            <FormField label="Fecha">
              <Input type="date" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} />
            </FormField>
            <FormField label="Desde">
              <Input type="time" value={nueva.horaDesde} onChange={(e) => setNueva({ ...nueva, horaDesde: e.target.value })} />
            </FormField>
            <FormField label="Hasta">
              <Input type="time" value={nueva.horaHasta} onChange={(e) => setNueva({ ...nueva, horaHasta: e.target.value })} />
            </FormField>
            <FormField label="¿Lleva frío?">
              <Select value={nueva.frio} onChange={(e) => setNueva({ ...nueva, frio: e.target.value })}>
                {Object.entries(FRIO).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Notas" className="sm:col-span-2 lg:col-span-4">
              <Input value={nueva.notas} onChange={(e) => setNueva({ ...nueva, notas: e.target.value })} placeholder="Referencias, a quién entregar…" />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit">Mandar solicitud</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {lista === null ? (
        <SkeletonTabla />
      ) : lista.length === 0 ? (
        <EmptyState message={esMatriz ? "No hay solicitudes de ruta." : "Todavía no has pedido entregas."} />
      ) : (
        lista.map((s) => <TarjetaSolicitud key={s._id} solicitud={s} esMatriz={esMatriz} zona={zona} onCambio={cargar} />)
      )}
    </div>
  );
}

function TarjetaSolicitud({ solicitud: s, esMatriz, zona, onCambio }: { solicitud: SolicitudVista; esMatriz: boolean; zona: string; onCambio: () => void }) {
  const [salidaId, setSalidaId] = useState(s.sugeridaId ?? "");
  const [reprogramando, setReprogramando] = useState(false);
  const [propuesta, setPropuesta] = useState({ fecha: s.fecha, horaDesde: s.horaDesde, horaHasta: s.horaHasta, comentario: "" });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const estado = ESTADO[s.estado] ?? ESTADO.pendiente;

  async function accion(cuerpo: Record<string, unknown>) {
    setEnviando(true);
    setError(null);
    const res = await fetch(`/api/solicitudes-ruta/${s._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    setEnviando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo guardar");
    setReprogramando(false);
    onCambio();
  }

  return (
    <Card className={s.estado === "pendiente" ? "border-l-4 border-l-amber-400" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-titos-green-900">
            {s.folio} · {s.sucursalNombre}
          </p>
          <p className="text-sm">
            {s.fecha} · {s.horaDesde}-{s.horaHasta} · {FRIO[s.frio] ?? s.frio}
          </p>
          <p className="text-sm text-black/65">
            {s.direccion}
            {s.zona ? ` · ${s.zona}` : ""}
          </p>
          {s.pedido ? (
            <p className="text-xs text-black/50">
              Pedido {s.pedido.folio} · {s.pedido.estado}
              {s.pedido.estado !== "surtido" && s.pedido.estado !== "recibido" ? " (todavía no está surtido)" : ""}
            </p>
          ) : null}
          {s.notas ? <p className="text-xs text-black/50">{s.notas}</p> : null}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.clase}`}>{estado.texto}</span>
      </div>

      {s.confirmacion ? (
        <p className="mt-2 rounded-lg bg-titos-green-100/60 px-3 py-2 text-sm">
          Va en <strong>{s.confirmacion.salidaNombre}</strong>, sale {s.confirmacion.fecha} {s.confirmacion.horaSalida}
          {s.confirmacion.choferNombre ? ` · chofer ${s.confirmacion.choferNombre}` : ""}
          {s.confirmacion.vehiculoNombre ? ` · ${s.confirmacion.vehiculoNombre}` : ""}
        </p>
      ) : null}
      {s.propuesta ? (
        <p className="mt-2 rounded-lg bg-sky-100/60 px-3 py-2 text-sm">
          El CEDIS propone <strong>{s.propuesta.fecha}</strong> de {s.propuesta.horaDesde} a {s.propuesta.horaHasta}
          {s.propuesta.comentario ? ` · ${s.propuesta.comentario}` : ""}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {esMatriz && s.estado === "pendiente" ? (
          s.opciones?.length ? (
            <>
              <Select value={salidaId} onChange={(e) => setSalidaId(e.target.value)} className="min-w-0 sm:w-96" aria-label="Salida">
                <option value="">— Elige la salida —</option>
                {s.opciones.map((o) => (
                  <option key={o._id} value={o._id} disabled={!o.apta}>
                    {o._id === s.sugeridaId ? "★ " : ""}
                    {o.horaSalida} · {o.nombre}
                    {o.vehiculoNombre ? ` · ${o.vehiculoNombre}` : ""}
                    {o.choferNombre ? ` · ${o.choferNombre}` : ""}
                    {o.motivo ? ` — ${o.motivo}` : ""}
                  </option>
                ))}
              </Select>
              <Button disabled={!salidaId || enviando} onClick={() => accion({ accion: "confirmar", salidaId })}>
                Confirmar
              </Button>
            </>
          ) : (
            <span className="text-sm text-black/50">No hay salidas programadas el {s.fecha}: arma el rol de ese día o propón otro horario.</span>
          )
        ) : null}
        {esMatriz && s.estado === "pendiente" ? (
          <Button variant="ghost" onClick={() => setReprogramando((v) => !v)}>
            Proponer otro horario
          </Button>
        ) : null}
        {esMatriz && s.estado === "confirmada" ? (
          <Button variant="ghost" disabled={enviando} onClick={() => accion({ accion: "entregada" })}>
            Marcar entregada
          </Button>
        ) : null}
        {!esMatriz && s.estado === "reprogramada" ? (
          <Button disabled={enviando} onClick={() => accion({ accion: "aceptar" })}>
            Aceptar horario
          </Button>
        ) : null}
        {!esMatriz && ["pendiente", "reprogramada", "confirmada"].includes(s.estado) ? (
          <Button
            variant="ghost"
            disabled={enviando}
            onClick={() => {
              const motivo = window.prompt("¿Por qué se cancela? (opcional)");
              if (motivo !== null) accion({ accion: "cancelar", motivo });
            }}
          >
            Cancelar
          </Button>
        ) : null}
      </div>

      {reprogramando ? (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-black/2 p-3 sm:grid-cols-5">
          <Input type="date" value={propuesta.fecha} onChange={(e) => setPropuesta({ ...propuesta, fecha: e.target.value })} aria-label="Fecha propuesta" />
          <Input type="time" value={propuesta.horaDesde} onChange={(e) => setPropuesta({ ...propuesta, horaDesde: e.target.value })} aria-label="Desde" />
          <Input type="time" value={propuesta.horaHasta} onChange={(e) => setPropuesta({ ...propuesta, horaHasta: e.target.value })} aria-label="Hasta" />
          <Input value={propuesta.comentario} onChange={(e) => setPropuesta({ ...propuesta, comentario: e.target.value })} placeholder="Motivo (opcional)" aria-label="Comentario" />
          <Button disabled={enviando} onClick={() => accion({ accion: "reprogramar", ...propuesta })}>
            Proponer
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {s.historial.length ? (
        <details className="mt-2 text-xs text-black/50">
          <summary className="cursor-pointer">Historial</summary>
          <ul className="mt-1 space-y-0.5">
            {s.historial.map((h, i) => (
              <li key={i}>
                {formatFechaHora(h.en, zona)} · {h.porNombre}: {h.texto}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
