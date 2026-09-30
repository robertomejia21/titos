"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarClock,
  Check,
  Clock,
  MessageCircleWarning,
  OctagonX,
  RefreshCw,
  SquareCheckBig,
} from "lucide-react";
import { Button, Card, EmptyState, FormField, Input, Modal, Pagination, formatMoney } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { formatFechaHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

type Sucursal = {
  _id: string;
  nombre: string;
  whatsapp: string;
  activo: boolean;
};

type MovimientoVentas2 = {
  id: string;
  folio: string;
  fecha: string;
  total: number;
  estado: string;
  secuenciaEfectivo: number | null;
};

type ActivacionVentas2 = {
  id: string;
  sucursalId: string;
  sucursalNombre: string;
  inicio: string;
  /** `null` cuando el protocolo es indefinido: corre hasta que se detenga. */
  fin: string | null;
  frecuencia: number;
  estado: "programada" | "activa" | "finalizada" | "cancelada";
  totalRecaudado: number;
  cantidadMovimientos: number;
  ultimoMovimiento: string | null;
  notificacionInicio: { estado: string; fecha: string | null; error: string };
  notificacionFin: { estado: string; fecha: string | null; error: string };
  retiradoEn: string | null;
  movimientos: MovimientoVentas2[];
};

function datetimeLocal(fecha: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function formatoFecha(value: string | null) {
  return formatFechaHora(value, ZONA_HORARIA_DEFAULT, "-");
}

/** El fin de una activacion indefinida se lee distinto segun si ya se detuvo. */
function formatoFin(activacion: ActivacionVentas2) {
  if (activacion.fin) return formatoFecha(activacion.fin);
  return activacion.estado === "finalizada" || activacion.estado === "cancelada" ? "-" : "Indefinido";
}

function estadoClase(estado: string) {
  if (estado === "activa") return "bg-titos-green-100 text-titos-green-700";
  if (estado === "finalizada") return "bg-black/5 text-black/60";
  if (estado === "programada") return "bg-sky-100 text-sky-800";
  return "bg-red-100 text-red-700";
}

function avisoLabel(notificacion: { estado: string; error: string }) {
  if (notificacion.estado === "enviada") return "Enviada";
  if (notificacion.estado === "sin_whatsapp") return "Sin WhatsApp";
  if (notificacion.estado === "fallida") return "Fallida";
  return "Pendiente";
}

export function Ventas2Manager() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [activaciones, setActivaciones] = useState<ActivacionVentas2[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [inicio, setInicio] = useState(() => datetimeLocal(new Date()));
  const [fin, setFin] = useState(() => datetimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [finIndefinido, setFinIndefinido] = useState(false);
  const [frecuencia, setFrecuencia] = useState("5");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [porDetener, setPorDetener] = useState<ActivacionVentas2 | null>(null);

  const sucursalesActivas = useMemo(() => sucursales.filter((s) => s.activo), [sucursales]);
  // "En curso" incluye las programadas: detenerlas antes de que arranquen también
  // debe ser posible sin esperar a que corra el lapso.
  const enCurso = useMemo(
    () => activaciones.filter((a) => a.estado === "activa" || a.estado === "programada"),
    [activaciones]
  );
  const totalRecaudado = useMemo(() => activaciones.reduce((sum, a) => sum + a.totalRecaudado, 0), [activaciones]);
  const pendientesRetiro = useMemo(
    () => activaciones.filter((a) => a.estado === "finalizada" && a.totalRecaudado > 0 && !a.retiradoEn).length,
    [activaciones]
  );
  const { pagina: paginaActivaciones, paginacion: paginacionActivaciones } = usePaginacion(activaciones);

  async function cargar() {
    setLoading(true);
    const [resSucursales, resVentas2] = await Promise.all([fetch("/api/sucursales"), fetch("/api/ventas2")]);
    if (resSucursales.ok) setSucursales(await resSucursales.json());
    if (resVentas2.ok) {
      const data = await resVentas2.json();
      setActivaciones(data.activaciones ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  function toggleSucursal(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function seleccionarTodas() {
    setSeleccionadas(new Set(sucursalesActivas.map((s) => s._id)));
  }

  async function activar() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/ventas2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sucursalIds: Array.from(seleccionadas),
        inicio: new Date(inicio).toISOString(),
        fin: finIndefinido ? null : new Date(fin).toISOString(),
        indefinido: finIndefinido,
        frecuencia: Number(frecuencia),
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo activar Notas de venta");
      return;
    }

    setSeleccionadas(new Set());
    await cargar();
  }

  async function accionar(id: string, accion: "terminar" | "retirar" | "cancelar") {
    setAccionando(`${id}:${accion}`);
    const res = await fetch(`/api/ventas2/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    setAccionando(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo completar la acción");
      return;
    }
    await cargar();
  }

  /**
   * Detener corta el protocolo en el momento, sin esperar a que se cumpla el
   * lapso: si ya arrancó se finaliza (conservando lo recaudado) y si todavía no
   * empieza se cancela.
   */
  async function detener(activacion: ActivacionVentas2) {
    setPorDetener(null);
    await accionar(activacion.id, activacion.estado === "activa" ? "terminar" : "cancelar");
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-black/50">Total Notas de venta</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-900">{formatMoney(totalRecaudado)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Activaciones activas</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-700">
            {activaciones.filter((a) => a.estado === "activa").length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Pendientes de retirar</p>
          <p className="mt-1 text-2xl font-bold text-titos-orange-600">{pendientesRetiro}</p>
        </Card>
      </div>

      {enCurso.length > 0 ? (
        <Card className="border-titos-orange-600/30 bg-titos-orange-100/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-titos-green-900">Notas de venta en curso</h2>
              <p className="text-sm text-black/55">
                Puedes detenerlas en cualquier momento, sin esperar a que termine el lapso programado.
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {enCurso.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium text-titos-green-900">
                    {a.sucursalNombre}{" "}
                    <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${estadoClase(a.estado)}`}>
                      {a.estado}
                    </span>
                  </p>
                  <p className="text-xs text-black/50">
                    {formatoFecha(a.inicio)} → {formatoFin(a)} · 1 de cada {a.frecuencia} · {a.cantidadMovimientos}{" "}
                    mov. · {formatMoney(a.totalRecaudado)}
                  </p>
                </div>
                <Button variant="danger" onClick={() => setPorDetener(a)} disabled={accionando?.startsWith(a.id)}>
                  <span className="flex items-center gap-1.5">
                    <OctagonX className="h-4 w-4" />
                    {accionando?.startsWith(a.id) ? "Deteniendo..." : "Detener notas de venta"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Activar protocolo</h2>
          <Button variant="ghost" onClick={seleccionarTodas} disabled={sucursalesActivas.length === 0}>
            Todas las sucursales
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="mb-2 text-sm font-medium text-black/70">Sucursales</p>
            {sucursalesActivas.length === 0 ? (
              <EmptyState message="No hay sucursales activas disponibles." />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sucursalesActivas.map((sucursal) => (
                  <label
                    key={sucursal._id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-black/10 px-3 py-2 text-sm hover:bg-black/2"
                  >
                    <span>
                      <span className="font-medium text-titos-green-900">{sucursal.nombre}</span>
                      <span className="block text-xs text-black/40">{sucursal.whatsapp || "Sin WhatsApp"}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={seleccionadas.has(sucursal._id)}
                      onChange={() => toggleSucursal(sucursal._id)}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <FormField label="Inicio">
              <Input icon={CalendarClock} type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </FormField>
            <FormField label="Fin">
              <Input
                icon={Clock}
                type="datetime-local"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
                disabled={finIndefinido}
                className={finIndefinido ? "bg-black/3 text-black/35" : ""}
              />
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-black/70">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={finIndefinido}
                  onChange={(e) => setFinIndefinido(e.target.checked)}
                />
                <span>
                  Indefinido
                  <span className="block text-xs text-black/45">
                    Corre sin fecha de fin hasta que lo detengas con el botón.
                  </span>
                </span>
              </label>
            </FormField>
            <FormField label="Frecuencia">
              <Input
                icon={Banknote}
                type="number"
                min="2"
                step="1"
                value={frecuencia}
                onChange={(e) => setFrecuencia(e.target.value)}
                placeholder="Ej. 5"
              />
            </FormField>
            <p className="text-xs text-black/45">
              La regla aplica solo a ventas pagadas 100% en efectivo: 1 de cada {Number(frecuencia) || "X"} se registra en Notas de venta.
            </p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button onClick={activar} disabled={saving || seleccionadas.size === 0} className="w-full justify-center">
              {saving ? "Activando..." : "Activar Notas de venta"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Resumen por sucursal</h2>
          <Button variant="ghost" onClick={cargar} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Actualizar
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : activaciones.length === 0 ? (
          <EmptyState message="Todavia no hay activaciones de Notas de venta." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Sucursal</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Estado</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Lapso</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Regla</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Movs.</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Total</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Avisos</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Retiro</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {paginaActivaciones.map((a) => (
                  <tr key={a.id} className="border-b border-black/5">
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-titos-green-900">{a.sucursalNombre}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${estadoClase(a.estado)}`}>
                        {a.estado}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">
                      {formatoFecha(a.inicio)}
                      <span className="text-black/30"> – </span>
                      <span className={a.fin ? "" : "font-semibold text-titos-orange-600"}>
                        {formatoFin(a)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">1 / {a.frecuencia}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{a.cantidadMovimientos}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-titos-green-900">{formatMoney(a.totalRecaudado)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-black/55">
                      <span className="inline-flex items-center gap-1">
                        <MessageCircleWarning className="h-3.5 w-3.5" />
                        Inicio: {avisoLabel(a.notificacionInicio)}
                      </span>
                      <span className="ml-2 inline-flex items-center gap-1">
                        <MessageCircleWarning className="h-3.5 w-3.5" />
                        Fin: {avisoLabel(a.notificacionFin)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">
                      {a.retiradoEn ? (
                        <span className="inline-flex items-center gap-1 text-titos-green-700">
                          <Check className="h-3.5 w-3.5" />
                          {formatoFecha(a.retiradoEn)}
                        </span>
                      ) : a.estado === "finalizada" && a.totalRecaudado > 0 ? (
                        <span className="text-amber-600">Pendiente</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        {a.estado === "activa" || a.estado === "programada" ? (
                          <Button variant="danger" size="sm" onClick={() => setPorDetener(a)} disabled={accionando?.startsWith(a.id)}>
                            <span className="flex items-center gap-1.5">
                              <OctagonX className="h-4 w-4" />
                              Detener
                            </span>
                          </Button>
                        ) : null}
                        {a.estado === "finalizada" && a.totalRecaudado > 0 && !a.retiradoEn ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => accionar(a.id, "retirar")}
                            disabled={accionando === `${a.id}:retirar`}
                          >
                            <SquareCheckBig className="mr-1 h-4 w-4" />
                            Retirado
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacionActivaciones} />
          </>
        )}
      </Card>

      {porDetener ? (
        <Modal open onClose={() => setPorDetener(null)} title="Detener notas de venta" icon={OctagonX}>
          <p className="text-sm text-black/70">
            Se detiene el protocolo en <strong>{porDetener.sucursalNombre}</strong> ahora mismo. A partir de este
            momento ninguna venta nueva se marcará como nota de venta.
          </p>
          {porDetener.estado === "activa" ? (
            <p className="mt-3 rounded-lg bg-black/2 px-3 py-2 text-sm text-black/60">
              Lo ya recaudado se conserva: {porDetener.cantidadMovimientos} movimiento(s) por{" "}
              {formatMoney(porDetener.totalRecaudado)}. La activación queda como finalizada y lista para marcar el
              retiro del efectivo.
            </p>
          ) : (
            <p className="mt-3 rounded-lg bg-black/2 px-3 py-2 text-sm text-black/60">
              Todavía no arranca, así que la activación se cancela y no llegará a aplicar.
            </p>
          )}
          {porDetener.fin === null && porDetener.estado === "activa" ? (
            <p className="mt-3 text-sm text-black/55">
              Este protocolo se activó como indefinido: detenerlo ahora es la única forma de cerrarlo.
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2 border-t border-black/5 pt-4">
            <Button variant="ghost" onClick={() => setPorDetener(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => detener(porDetener)}>
              Sí, detener ahora
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
