"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { fechaEnZona, sumarDias } from "@/lib/zonasHorarias";
import { ETAPA_CARGA_LABEL, type EtapaCarga } from "@/lib/logistica";

type Empleado = { _id: string; nombre: string; puesto: string; activo?: boolean };
type SalidaRol = { _id: string; nombre: string; horaSalida: string; estado: string; vehiculoNombre: string; choferNombre: string };
type Opcion = { valor: string; fecha: string; salidaId: string; etiqueta: string };

/**
 * Pre-carga del folio en una salida de hoy o de mañana, confirmación de
 * "vehículo cargado" y bajar de la unidad. El chofer no se toca aquí: se
 * confirma al arrancar la salida en el rol de entregas.
 */
export function AccionesCarga({
  pedidoId,
  etapa,
  impedimentos,
  fechaSalida,
  salidaId,
  onActualizado,
}: {
  pedidoId: string;
  etapa: EtapaCarga;
  impedimentos: string[];
  fechaSalida?: string | null;
  salidaId?: string | null;
  onActualizado?: (pedido: unknown) => void;
}) {
  const router = useRouter();
  const zona = useZonaHoraria();
  const [opciones, setOpciones] = useState<Opcion[] | null>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [eleccion, setEleccion] = useState("");
  const [cargadorId, setCargadorId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoy = fechaEnZona(new Date(), zona);
  const manana = sumarDias(hoy, 1);

  useEffect(() => {
    if (etapa === "en_ruta") return;
    let vigente = true;
    Promise.all(
      [manana, hoy].map((fecha) =>
        fetch(`/api/operacion/rol?fecha=${fecha}`)
          .then((r) => (r.ok ? r.json() : { salidas: [] }))
          .then((rol: { salidas?: SalidaRol[] }) =>
            (rol.salidas ?? [])
              .filter((s) => s.estado === "programada")
              .map((s) => ({
                valor: `${fecha}|${s._id}`,
                fecha,
                salidaId: s._id,
                etiqueta: `${fecha === hoy ? "Hoy" : "Mañana"} ${s.horaSalida} · ${s.nombre}${s.vehiculoNombre ? ` · ${s.vehiculoNombre}` : ""}${s.choferNombre ? ` · chofer programado ${s.choferNombre}` : ""}`,
              }))
          )
      )
    ).then((listas) => {
      if (!vigente) return;
      const todas = listas.flat();
      setOpciones(todas);
      const actual = fechaSalida && salidaId ? `${fechaSalida}|${salidaId}` : "";
      setEleccion(todas.some((o) => o.valor === actual) ? actual : (todas[0]?.valor ?? ""));
    });
    fetch("/api/empleados")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Empleado[]) => vigente && setEmpleados(lista.filter((e) => e.activo !== false)));
    return () => {
      vigente = false;
    };
  }, [etapa, hoy, manana, fechaSalida, salidaId]);

  const opcionActual = useMemo(() => opciones?.find((o) => o.valor === eleccion), [opciones, eleccion]);
  const esLaActual = !!fechaSalida && opcionActual?.fecha === fechaSalida && opcionActual?.salidaId === salidaId;

  async function enviar(cuerpo: Record<string, unknown>) {
    setEnviando(true);
    setError(null);
    const res = await fetch(`/api/pedidos/${pedidoId}/carga`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    setEnviando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "No se pudo actualizar la carga");
    if (onActualizado) onActualizado(data);
    else router.refresh();
  }

  if (etapa === "en_ruta") return <p className="text-sm text-black/60">El folio ya salió a ruta.</p>;

  const selectorSalida =
    opciones === null ? (
      <p className="text-xs text-black/40">Cargando salidas...</p>
    ) : opciones.length === 0 ? (
      <p className="text-xs text-black/50">
        No hay salidas programadas para hoy ni mañana.{" "}
        <Link href="/matriz/rutas" className="font-medium text-titos-green-700 underline">
          Arma el rol de entregas
        </Link>
      </p>
    ) : (
      <Select value={eleccion} onChange={(e) => setEleccion(e.target.value)} className="min-w-0 max-w-full sm:w-96" aria-label="Salida">
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Select>
    );

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Etapa: <strong>{ETAPA_CARGA_LABEL[etapa]}</strong>
      </p>

      {etapa === "sin_cargar" && impedimentos.length > 0 ? (
        <ul className="list-inside list-disc text-sm text-amber-700">
          {impedimentos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {selectorSalida}
          {opcionActual ? (
            <Button
              variant={etapa === "sin_cargar" ? "primary" : "ghost"}
              disabled={enviando || esLaActual}
              onClick={() => enviar({ accion: "precargar", fecha: opcionActual.fecha, salidaId: opcionActual.salidaId })}
            >
              {etapa === "sin_cargar" ? "Pre-cargar" : esLaActual ? "Va en esta salida" : "Cambiar a esta salida"}
            </Button>
          ) : null}
        </div>
      )}

      {etapa === "precargado" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={cargadorId} onChange={(e) => setCargadorId(e.target.value)} className="w-56" aria-label="Cargador">
            <option value="">— Quién cargó —</option>
            {empleados.map((e) => (
              <option key={e._id} value={e._id}>
                {e.nombre}
                {e.puesto ? ` · ${e.puesto}` : ""}
              </option>
            ))}
          </Select>
          <Button disabled={enviando} onClick={() => enviar({ accion: "cargado", cargadorId: cargadorId || null })}>
            Confirmar vehículo cargado
          </Button>
        </div>
      ) : null}

      {etapa !== "sin_cargar" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={enviando}
          onClick={() => {
            const motivo = window.prompt("¿Por qué se baja de la unidad? (opcional)") ?? null;
            if (motivo !== null) enviar({ accion: "deshacer", motivo });
          }}
        >
          Bajar de la unidad
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
