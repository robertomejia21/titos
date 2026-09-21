"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  FormField,
  Input,
  Modal,
  Pagination,
  Select,
  formatMoney,
} from "@/components/ui";
import { fechaEnZona, sumarDias, formatFechaHora } from "@/lib/zonasHorarias";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import type { ResumenGlobal, DocumentoGlobal } from "@/lib/facturaGlobalTipos";
import type { SucursalFiltro } from "./FiltrosSucursalFecha";
import { ExportarExcelButton } from "@/components/ExportarExcelButton";
import { excelGlobal } from "@/lib/exportacionesFinancieras";

export function FacturaGlobalManager({
  sucursales,
}: {
  sucursales: SucursalFiltro[];
}) {
  const zona = useZonaHoraria();
  const [dia, setDia] = useState(() =>
    sumarDias(fechaEnZona(new Date(), zona), -1),
  );
  const [sucursalId, setSucursalId] = useState("");
  const [revision, setRevision] = useState(0);
  const [datos, setDatos] = useState<ResumenGlobal | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [cancelar, setCancelar] = useState<DocumentoGlobal | null>(null);
  const [motivo, setMotivo] = useState("");
  const [page, setPage] = useState(1);
  const enviando = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    async function cargar() {
      setLoading(true);
      setError("");
      setDatos(null);
      setPage(1);
      try {
        const params = new URLSearchParams({ dia, sucursalId });
        const res = await fetch(`/api/facturas/global?${params}`, {
          signal: abort.signal,
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error || "No se pudo consultar el día.");
        setDatos(data);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No se pudo consultar el día.",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void cargar();
    return () => abort.abort();
  }, [dia, sucursalId, revision]);

  async function guardar(cancelacion = false) {
    if (!datos || enviando.current) return;
    enviando.current = true;
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(
        cancelacion
          ? `/api/facturas/global/${cancelar!._id}`
          : "/api/facturas/global",
        {
          method: cancelacion ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            cancelacion
              ? { motivo }
              : {
                  dia: datos.dia,
                  sucursalId: datos.sucursalId,
                  huella: datos.huella,
                },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error || "No se pudo guardar. Actualiza antes de reintentar.",
        );
      setConfirmar(false);
      setCancelar(null);
      setMotivo("");
      setRevision((r) => r + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo guardar. Actualiza antes de reintentar.",
      );
    } finally {
      enviando.current = false;
      setGuardando(false);
    }
  }

  const tieneGlobal = datos?.globales.some(
    (g) =>
      g.estado === "generada" && g.alcance === (datos.sucursalId || "todas"),
  );
  const puedeGenerar =
    datos &&
    datos.dia < datos.hoy &&
    datos.pendientes.length > 0 &&
    !datos.avisos.length &&
    !tieneGlobal;
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-lg font-semibold text-titos-green-900">
          Factura global del día
        </h2>
        <p className="mt-1 text-sm text-black/70">
          Al abrir se prepara el día anterior. Agrupa las ventas sin factura
          individual, con todas las tiendas seleccionadas por defecto.
        </p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <strong>Documento interno, sin timbrar.</strong> Los importes vienen
          del punto de venta. El timbrado SAT y el desglose fiscal siguen
          pendientes.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <FormField label="Día de ventas">
            <Input
              aria-label="Día de ventas"
              type="date"
              value={dia}
              max={fechaEnZona(new Date(), zona)}
              onChange={(e) => setDia(e.target.value)}
              disabled={guardando}
            />
          </FormField>
          <FormField label="Sucursal">
            <Select
              aria-label="Sucursal de la global"
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              disabled={guardando}
            >
              <option value="">Todas las sucursales · mismo RFC</option>
              {sucursales.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </FormField>
          <Button
            variant="secondary"
            onClick={() => setRevision((r) => r + 1)}
            disabled={loading || guardando}
          >
            Actualizar resumen
          </Button>
          <ExportarExcelButton disabled={loading || guardando || !!error || !datos || datos.dia !== dia || datos.sucursalId !== sucursalId}
            crearReporte={() => excelGlobal(datos!)} />
        </div>
        <p className="mt-2 text-xs text-black/65">
          Se usa el día de corte registrado en cada venta. Incluye tickets y
          notas de venta; excluye ventas canceladas.
        </p>
      </Card>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {loading && <p role="status">Consultando ventas y facturas…</p>}
      {datos && !loading && (
        <>
          <Card>
            <h3 className="font-semibold text-titos-green-900">
              Conciliación · {datos.dia} · {datos.sucursalNombre}
            </h3>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Ventas del día", datos.totalVentas],
                ["Facturas individuales", datos.totalIndividuales],
                ["Globales vigentes", datos.totalGlobales],
                ["Pendiente de incluir", datos.totalPendiente],
              ].map(([label, total]) => (
                <div key={String(label)}>
                  <dt className="text-sm text-black/70">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-titos-green-900">
                    {formatMoney(Number(total))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-black/10 pt-3 text-sm font-medium">
              Individuales + globales + pendientes = ventas del día. Diferencia:{" "}
              {formatMoney(datos.diferencia)}.
            </p>
            <p className="mt-1 text-sm text-black/70">
              {datos.ventas} ventas.{" "}
              {datos.totalPendiente === 0 &&
              datos.diferencia === 0 &&
              datos.ventas > 0
                ? "Todas las ventas están incluidas en documentos internos."
                : "Revisa el pendiente antes de dar por conciliado el día."}
            </p>
            <div className="mt-3 space-y-1 text-sm text-black/70">
              <p>
                Crédito incluido en las ventas: {formatMoney(datos.credito)}. No
                es efectivo recibido.
              </p>
              <p>
                Devoluciones pagadas ese día:{" "}
                {formatMoney(datos.devolucionesDia)}. Ventas menos estas
                devoluciones: {formatMoney(datos.netoTrasDevoluciones)}.
              </p>
              <p>
                Las devoluciones pueden ser de ventas de otros días y se
                muestran aparte. Abonos, fondos y retiros no son ventas y no se
                agregan a la global.
              </p>
            </div>
            {datos.avisos.map((a) => (
              <p
                key={a}
                className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800"
              >
                {a}
              </p>
            ))}
            {datos.dia >= datos.hoy && (
              <p className="mt-2 text-sm text-amber-900">
                El día sigue abierto; podrás generar la global cuando termine.
              </p>
            )}
          </Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-titos-green-900">
                Ventas pendientes para la global ({datos.pendientes.length})
              </h3>
              <Button
                disabled={!puedeGenerar || guardando}
                onClick={() => {
                  setError("");
                  setConfirmar(true);
                }}
              >
                Generar global interna
              </Button>
            </div>
            {tieneGlobal && datos.pendientes.length > 0 && (
              <p className="mt-2 text-sm text-amber-900">
                Hay ventas pendientes después de generar la global. Cancela la global
                interna y vuelve a generarla para incluirlas.
              </p>
            )}
            {datos.pendientes.length === 0 ? (
              <p className="mt-4 text-sm text-black/70">
                No hay ventas pendientes para este día y selección.
              </p>
            ) : (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-black/15">
                        <th className="p-2">Ticket</th>
                        <th className="p-2">Sucursal</th>
                        <th className="p-2">Tipo</th>
                        <th className="p-2 text-right">Importe MXN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.pendientes
                        .slice((page - 1) * 20, page * 20)
                        .map((v) => (
                          <tr
                            key={v.ventaId}
                            className="border-b border-black/5"
                          >
                            <td className="p-2">{v.folio}</td>
                            <td className="p-2">{v.sucursalNombre}</td>
                            <td className="p-2">
                              {v.esVentas2 ? "Nota de venta" : "Ticket"}
                            </td>
                            <td className="p-2 text-right">
                              {formatMoney(v.total)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(datos.pendientes.length / 20),
                  )}
                  totalItems={datos.pendientes.length}
                  pageSize={20}
                  onChange={setPage}
                />
              </>
            )}
          </Card>
          <Card>
            <h3 className="font-semibold text-titos-green-900">
              Globales del día ({datos.globales.length})
            </h3>
            {!datos.globales.length && (
              <p className="mt-3 text-sm text-black/70">
                Todavía no se genera una global interna de este día.
              </p>
            )}
            <ul className="divide-y divide-black/10">
              {datos.globales.map((g) => (
                <li key={g._id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {g.folio} · {g.estado}
                      </p>
                      <p className="mt-1 text-sm text-black/70">
                        {g.sucursalNombre} · {g.ventas.length} tickets ·{" "}
                        {formatFechaHora(g.createdAt, datos.zonaHoraria)}
                      </p>
                      <p className="text-sm text-black/70">
                        Total del documento: {formatMoney(g.total)}
                        {sucursalId && g.totalConsulta !== g.total
                          ? ` · Esta sucursal: ${formatMoney(g.totalConsulta)}`
                          : ""}
                      </p>
                      {g.estado === "cancelada" && (
                        <p className="mt-1 text-sm text-red-800">
                          Motivo: {g.motivoCancelacion}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <a
                        className="rounded-lg border border-titos-green-700 px-3 py-2 text-sm font-medium text-titos-green-800"
                        href={`/api/facturas/global/${g._id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Descargar PDF
                      </a>
                      {g.estado === "generada" && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setCancelar(g);
                            setMotivo("");
                            setError("");
                          }}
                        >
                          Cancelar global interna
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <details className="rounded-xl border border-black/10 bg-white p-4">
            <summary className="cursor-pointer font-medium">
              Facturas individuales excluidas ({datos.individuales.length})
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {datos.individuales.map((f) => (
                <li key={f.folio}>
                  {f.folio} · venta {f.ventaFolio} · {formatMoney(f.total)} ·{" "}
                  {f.timbrada ? "Timbrada" : "Sin timbrar"}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {confirmar && datos && (
        <Modal
          open
          title="Generar global interna"
          onClose={() => {
            if (!guardando) setConfirmar(false);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={guardando}
                onClick={() => setConfirmar(false)}
              >
                Regresar
              </Button>
              <Button disabled={guardando} onClick={() => guardar()}>
                {guardando ? "Generando…" : "Confirmar global interna"}
              </Button>
            </>
          }
        >
          <p>
            {datos.sucursalNombre} · {datos.dia}
          </p>
          <p className="mt-3 font-semibold">
            {datos.pendientes.length} ventas por{" "}
            {formatMoney(datos.totalPendiente)}.
          </p>
          <p className="mt-3 text-sm">
            Se guardarán en un documento interno sin timbre fiscal. Estas ventas
            dejarán de aparecer en la bandeja individual. Para facturar una
            después, cancela esta global, genera la individual y vuelve a
            generar la global con las restantes.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </Modal>
      )}
      {cancelar && (
        <Modal
          open
          title="Cancelar global interna"
          onClose={() => {
            if (!guardando) setCancelar(null);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={guardando}
                onClick={() => setCancelar(null)}
              >
                Regresar
              </Button>
              <Button
                variant="danger"
                disabled={guardando || motivo.trim().length < 5}
                onClick={() => guardar(true)}
              >
                {guardando ? "Cancelando…" : "Confirmar cancelación"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm">
            Se liberan las ventas de {cancelar.folio} para volver a facturarlas.
            Se conserva el documento cancelado en el historial.
          </p>
          <FormField label="Motivo">
            <Input
              aria-label="Motivo de cancelación global"
              value={motivo}
              maxLength={1000}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
