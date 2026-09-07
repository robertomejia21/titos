"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, Card, EmptyState, FormField, Pagination, Select, formatMoney } from "@/components/ui";
import { FiltrosSucursalFecha, fechaISO, type SucursalFiltro } from "@/components/matriz/FiltrosSucursalFecha";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { ETIQUETA_TIPO_TARJETA, esTipoTarjeta } from "@/lib/tarjetas";

type VentaHistorial = {
  _id: string;
  folio: string;
  fecha: string;
  corte: string;
  sucursalNombre: string;
  clienteNombre: string;
  total: number;
  pagos: { metodoPago: string; monto: number; tarjetaTipo?: string | null }[];
  estado: string;
  esVentas2: boolean;
  articulos: number;
};

type Resumen = {
  cantidad: number;
  total: number;
  ticketPromedio: number;
  canceladas: number;
  totalCancelado: number;
  porMetodo: Record<string, number>;
  porTipoTarjeta: { tipo: string | null; etiqueta: string; monto: number }[];
  porSucursal: { sucursalId: string; nombre: string; cantidad: number; total: number }[];
  porDia: { corte: string; cantidad: number; total: number }[];
};

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  efectivo_usd: "Efectivo (dólares)",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales de despensa",
  credito: "Crédito",
};

const RESUMEN_VACIO: Resumen = {
  cantidad: 0,
  total: 0,
  ticketPromedio: 0,
  canceladas: 0,
  totalCancelado: 0,
  porMetodo: {},
  porTipoTarjeta: [],
  porSucursal: [],
  porDia: [],
};

const PAGE_SIZE = 25;

export function HistorialVentasManager() {
  const zonaHoraria = useZonaHoraria();
  const [sucursales, setSucursales] = useState<SucursalFiltro[]>([]);
  const [ventas, setVentas] = useState<VentaHistorial[]>([]);
  const [resumen, setResumen] = useState<Resumen>(RESUMEN_VACIO);

  const [sucursalId, setSucursalId] = useState("");
  const [desde, setDesde] = useState(() => fechaISO(30));
  const [hasta, setHasta] = useState(() => fechaISO());
  const [notasDeVenta, setNotasDeVenta] = useState("excluir");
  const [incluirCanceladas, setIncluirCanceladas] = useState(true);

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    params.set("notasDeVenta", notasDeVenta);
    if (incluirCanceladas) params.set("incluirCanceladas", "1");
    return params.toString();
  }, [sucursalId, desde, hasta, notasDeVenta, incluirCanceladas]);

  const cargar = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reportes/historial-ventas?${query()}`);
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setVentas(data.ventas ?? []);
    setResumen(data.resumen ?? RESUMEN_VACIO);
    setPage(1);
  }, [query]);

  useEffect(() => {
    fetch("/api/sucursales")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: SucursalFiltro[]) => setSucursales(data))
      .catch(() => setSucursales([]));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga el reporte cuando cambian los filtros
    cargar();
  }, [cargar]);

  const totalPages = Math.max(1, Math.ceil(ventas.length / PAGE_SIZE));
  const pagina = ventas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const mejorDia = resumen.porDia.reduce<{ corte: string; total: number } | null>(
    (mejor, dia) => (!mejor || dia.total > mejor.total ? dia : mejor),
    null
  );

  return (
    <div>
      <FiltrosSucursalFecha
        sucursales={sucursales}
        sucursalId={sucursalId}
        onSucursalId={setSucursalId}
        desde={desde}
        onDesde={setDesde}
        hasta={hasta}
        onHasta={setHasta}
      >
        <FormField label="Notas de venta">
          <Select value={notasDeVenta} onChange={(e) => setNotasDeVenta(e.target.value)}>
            <option value="excluir">Sin notas de venta</option>
            <option value="incluir">Incluir notas de venta</option>
            <option value="solo">Solo notas de venta</option>
          </Select>
        </FormField>
      </FiltrosSucursalFecha>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-sm text-black/50">Total vendido</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-900">{formatMoney(resumen.total)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Ventas</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-700">{resumen.cantidad}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Ticket promedio</p>
          <p className="mt-1 text-2xl font-bold text-sky-700">{formatMoney(resumen.ticketPromedio)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Canceladas</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{resumen.canceladas}</p>
          <p className="text-xs text-black/40">{formatMoney(resumen.totalCancelado)} sin cobrar</p>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-titos-green-900">Cobrado por forma de pago</h2>
          <ul className="space-y-2 text-sm">
            {Object.entries(ETIQUETA_METODO).map(([metodo, etiqueta]) => {
              const monto = resumen.porMetodo[metodo] ?? 0;
              const porcentaje = resumen.total > 0 ? (monto / resumen.total) * 100 : 0;
              return (
                <li key={metodo}>
                  <div className="flex items-center justify-between">
                    <span className="text-black/60">{etiqueta}</span>
                    <span className="font-semibold text-titos-green-900">{formatMoney(monto)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5">
                    <div className="h-full rounded-full bg-titos-green-600" style={{ width: `${porcentaje}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {/* La tarjeta se abre en crédito, débito y American Express: el banco
              deposita cada uno por separado y con su propia comisión. */}
          {(resumen.porTipoTarjeta ?? []).length > 0 ? (
            <div className="mt-4 border-t border-black/5 pt-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">Tarjeta por tipo</p>
              <ul className="space-y-1 text-sm">
                {(resumen.porTipoTarjeta ?? []).map((t) => (
                  <li key={t.tipo ?? t.etiqueta} className="flex items-center justify-between">
                    <span className="text-black/60">{t.etiqueta}</span>
                    <span className="font-medium text-titos-green-900">{formatMoney(t.monto)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {mejorDia ? (
            <p className="mt-4 border-t border-black/5 pt-3 text-xs text-black/45">
              Mejor día del periodo: {mejorDia.corte} con {formatMoney(mejorDia.total)}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-titos-green-900">Por sucursal</h2>
          {resumen.porSucursal.length === 0 ? (
            <EmptyState message="Sin ventas en el periodo." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="py-2 pr-3">Sucursal</th>
                    <th className="py-2 pr-3 text-right">Ventas</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 text-right">Participación</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.porSucursal.map((s) => (
                    <tr key={s.sucursalId} className="border-b border-black/5">
                      <td className="py-2 pr-3 font-medium text-titos-green-900">{s.nombre}</td>
                      <td className="py-2 pr-3 text-right">{s.cantidad}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{formatMoney(s.total)}</td>
                      <td className="py-2 text-right text-black/50">
                        {resumen.total > 0 ? `${((s.total / resumen.total) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Detalle de ventas</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-black/60">
              <input
                type="checkbox"
                checked={incluirCanceladas}
                onChange={(e) => setIncluirCanceladas(e.target.checked)}
              />
              Mostrar canceladas
            </label>
            <Button variant="ghost" onClick={cargar} disabled={loading}>
              <span className="flex items-center gap-1.5">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </span>
            </Button>
            <a href={`/api/reportes/historial-ventas/pdf?${query()}`} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" disabled={ventas.length === 0}>
                <span className="flex items-center gap-1.5">
                  <Download className="h-4 w-4" />
                  PDF
                </span>
              </Button>
            </a>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : ventas.length === 0 ? (
          <EmptyState message="No hay ventas registradas con estos filtros." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="py-2 pr-3">Folio</th>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Sucursal</th>
                    <th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3 text-right">Artículos</th>
                    <th className="py-2 pr-3">Forma de pago</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((v) => (
                    <tr key={v._id} className={`border-b border-black/5 ${v.estado === "cancelada" ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-3 font-medium text-titos-green-900">
                        {v.folio}
                        {v.esVentas2 ? (
                          <span className="ml-1.5 rounded-full bg-titos-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-titos-orange-700">
                            NV
                          </span>
                        ) : null}
                        {v.estado === "cancelada" ? (
                          <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            cancelada
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-black/55">{formatFechaHora(v.fecha, zonaHoraria, "—")}</td>
                      <td className="py-2 pr-3 text-black/70">{v.sucursalNombre}</td>
                      <td className="py-2 pr-3 text-black/55">{v.clienteNombre || "Público en general"}</td>
                      <td className="py-2 pr-3 text-right text-black/55">{v.articulos}</td>
                      <td className="py-2 pr-3 text-black/55">
                        {(v.pagos ?? [])
                          .map((p) => {
                            const etiqueta = ETIQUETA_METODO[p.metodoPago] ?? p.metodoPago;
                            // La tarjeta se lee con su tipo: es lo que distingue
                            // el depósito que va a llegar del banco.
                            return esTipoTarjeta(p.tarjetaTipo)
                              ? `${etiqueta} (${ETIQUETA_TIPO_TARJETA[p.tarjetaTipo]})`
                              : etiqueta;
                          })
                          .join(" + ")}
                      </td>
                      <td className="py-2 text-right font-semibold text-titos-green-900">{formatMoney(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={ventas.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
