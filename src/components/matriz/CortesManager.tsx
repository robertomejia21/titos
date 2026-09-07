"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Banknote } from "lucide-react";
import { Button, Card, EmptyState, FormField, Input, Select, formatMoney } from "@/components/ui";
import { fechaEnZona, formatFechaHora, formatHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

type Retiro = {
  _id: string;
  folio: string;
  monto: number;
  moneda: "MXN" | "USD";
  motivo: string;
  usuarioNombre: string;
  fecha: string;
};

type Corte = {
  _id: string;
  sucursalId: { _id: string; nombre: string; zonaHoraria?: string } | string;
  usuarioAperturaId?: { nombre?: string } | null;
  usuarioCierreId?: { nombre?: string } | null;
  fechaApertura: string;
  fechaCierre: string;
  efectivoInicial: number;
  efectivoInicialUsd?: number;
  totalVentasEfectivo: number;
  totalVentasTarjeta: number;
  totalVentasTransferencia: number;
  totalVentasVales?: number;
  totalVentasCredito?: number;
  totalVentasDolaresUsd?: number;
  totalVentasDolaresMxn?: number;
  totalCambioDolaresMxn?: number;
  tarjetaPorTerminal?: { terminalId: string | null; alias: string; monto: number }[];
  tarjetaPorTipo?: { tipo: string | null; etiqueta: string; monto: number }[];
  totalAbonosEfectivo?: number;
  totalDevoluciones?: number;
  totalRetiros: number;
  efectivoEsperado: number;
  efectivoContado: number;
  diferencia: number;
  totalRetirosUsd?: number;
  efectivoEsperadoUsd?: number;
  efectivoContadoUsd?: number;
  diferenciaUsd?: number;
  notas: string;
  retiros: Retiro[];
};

type Sucursal = { _id: string; nombre: string };

function nombreSucursal(corte: Corte) {
  return typeof corte.sucursalId === "string" ? "Sucursal" : corte.sucursalId.nombre;
}

// Matriz ve cortes de varias sucursales a la vez, así que cada uno se muestra
// en la zona horaria de su propia sucursal.
function zonaDelCorte(corte: Corte) {
  if (typeof corte.sucursalId === "string") return ZONA_HORARIA_DEFAULT;
  return corte.sucursalId.zonaHoraria || ZONA_HORARIA_DEFAULT;
}

function formatDolares(value: number) {
  return `$${value.toFixed(2)}`;
}

function hoyISO() {
  // En UTC, después de las 5 p.m. en Tijuana "hoy" ya sería mañana y el filtro
  // saldría vacío.
  return fechaEnZona(new Date(), ZONA_HORARIA_DEFAULT);
}

export function CortesManager() {
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

  const [sucursalId, setSucursalId] = useState("");
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res = await fetch(`/api/cortes?${params.toString()}`);
    setCargando(false);
    if (res.ok) setCortes(await res.json());
  }, [sucursalId, desde, hasta]);

  useEffect(() => {
    fetch("/api/sucursales")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Sucursal[]) => setSucursales(data))
      .catch(() => setSucursales([]));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar los filtros
    cargar();
  }, [cargar]);

  const totales = useMemo(
    () =>
      cortes.reduce(
        (acc, c) => ({
          efectivo: acc.efectivo + c.totalVentasEfectivo,
          tarjeta: acc.tarjeta + c.totalVentasTarjeta,
          transferencia: acc.transferencia + c.totalVentasTransferencia,
          vales: acc.vales + (c.totalVentasVales ?? 0),
          credito: acc.credito + (c.totalVentasCredito ?? 0),
          devoluciones: acc.devoluciones + (c.totalDevoluciones ?? 0),
          retiros: acc.retiros + c.totalRetiros,
          retirosUsd: acc.retirosUsd + (c.totalRetirosUsd ?? 0),
          dolaresUsd: acc.dolaresUsd + (c.totalVentasDolaresUsd ?? 0),
          dolaresMxn: acc.dolaresMxn + (c.totalVentasDolaresMxn ?? 0),
          diferencia: acc.diferencia + c.diferencia,
        }),
        {
          efectivo: 0,
          tarjeta: 0,
          transferencia: 0,
          vales: 0,
          credito: 0,
          devoluciones: 0,
          retiros: 0,
          retirosUsd: 0,
          dolaresUsd: 0,
          dolaresMxn: 0,
          diferencia: 0,
        }
      ),
    [cortes]
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label="Sucursal">
            <Select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </FormField>
          <FormField label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </FormField>
          <div className="flex items-end">
            <Button onClick={cargar} disabled={cargando} className="w-full justify-center">
              {cargando ? "Cargando..." : "Actualizar"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Ventas en efectivo</p>
          <p className="text-2xl font-bold text-titos-green-900">{formatMoney(totales.efectivo)}</p>
          {totales.dolaresUsd > 0 ? (
            <p className="text-sm font-semibold text-sky-700">
              + {formatDolares(totales.dolaresUsd)} USD cobrados ({formatMoney(totales.dolaresMxn)})
            </p>
          ) : null}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Tarjeta + transferencia</p>
          <p className="text-2xl font-bold text-titos-green-900">
            {formatMoney(totales.tarjeta + totales.transferencia)}
          </p>
          {totales.vales > 0 ? (
            <p className="text-sm font-semibold text-titos-orange-600">
              + {formatMoney(totales.vales)} en vales de despensa
            </p>
          ) : null}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Retiros</p>
          <p className="text-2xl font-bold text-titos-orange-600">{formatMoney(totales.retiros)}</p>
          {totales.retirosUsd > 0 ? (
            <p className="text-sm font-semibold text-sky-700">+ {formatDolares(totales.retirosUsd)} USD</p>
          ) : null}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Diferencia acumulada</p>
          <p className={`text-2xl font-bold ${totales.diferencia < 0 ? "text-red-600" : "text-titos-green-700"}`}>
            {formatMoney(totales.diferencia)}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">Cortes cerrados ({cortes.length})</h2>
        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : cortes.length === 0 ? (
          <EmptyState message="No hay cortes cerrados en el periodo seleccionado." />
        ) : (
          <ul className="divide-y divide-black/5">
            {cortes.map((corte) => {
              const abierto = expandido === corte._id;
              return (
                <li key={corte._id}>
                  <button
                    type="button"
                    onClick={() => setExpandido(abierto ? null : corte._id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left text-sm hover:bg-black/2"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {abierto ? (
                        <ChevronDown className="h-4 w-4 text-black/30" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-black/30" />
                      )}
                      {nombreSucursal(corte)}
                    </span>
                    <span className="text-xs text-black/40">{formatFechaHora(corte.fechaCierre, zonaDelCorte(corte))}</span>
                    <span className="text-black/50">
                      Efectivo {formatMoney(corte.efectivoContado)} / esperado {formatMoney(corte.efectivoEsperado)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        Math.abs(corte.diferencia) < 0.01
                          ? "bg-titos-green-100 text-titos-green-700"
                          : corte.diferencia < 0
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {Math.abs(corte.diferencia) < 0.01
                        ? "Cuadró"
                        : `${corte.diferencia < 0 ? "Faltante" : "Sobrante"} ${formatMoney(Math.abs(corte.diferencia))}`}
                    </span>
                  </button>

                  {abierto ? (
                    <div className="grid grid-cols-1 gap-4 pb-4 lg:grid-cols-2">
                      <div className="space-y-1 rounded-xl bg-black/2 p-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-black/50">Abrió / cerró</span>
                          <span className="font-medium">
                            {corte.usuarioAperturaId?.nombre ?? "—"} / {corte.usuarioCierreId?.nombre ?? "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black/50">Fondo inicial</span>
                          <span className="font-medium">{formatMoney(corte.efectivoInicial)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-black/50">+ Ventas en efectivo</span>
                          <span className="font-medium">{formatMoney(corte.totalVentasEfectivo)}</span>
                        </div>
                        {corte.totalAbonosEfectivo ? (
                          <div className="flex justify-between">
                            <span className="text-black/50">+ Abonos de clientes</span>
                            <span className="font-medium">{formatMoney(corte.totalAbonosEfectivo)}</span>
                          </div>
                        ) : null}
                        {corte.totalDevoluciones ? (
                          <div className="flex justify-between">
                            <span className="text-black/50">− Devoluciones</span>
                            <span className="font-medium">{formatMoney(corte.totalDevoluciones)}</span>
                          </div>
                        ) : null}
                        {corte.totalCambioDolaresMxn ? (
                          <div className="flex justify-between">
                            <span className="text-black/50">− Cambio por pagos en dólares</span>
                            <span className="font-medium">{formatMoney(corte.totalCambioDolaresMxn)}</span>
                          </div>
                        ) : null}
                        <div className="flex justify-between">
                          <span className="text-black/50">− Retiros</span>
                          <span className="font-medium">{formatMoney(corte.totalRetiros)}</span>
                        </div>
                        <div className="flex justify-between border-t border-black/10 pt-1.5 font-semibold">
                          <span>= Esperado / contado</span>
                          <span>
                            {formatMoney(corte.efectivoEsperado)} / {formatMoney(corte.efectivoContado)}
                          </span>
                        </div>
                        {corte.totalVentasCredito ? (
                          <div className="flex justify-between pt-1.5 text-black/50">
                            <span>Ventas a crédito (cartera)</span>
                            <span>{formatMoney(corte.totalVentasCredito)}</span>
                          </div>
                        ) : null}
                        {/* El banco liquida crédito, débito y American Express
                            por separado y con su propia comisión. */}
                        {(corte.tarjetaPorTipo ?? []).length > 0 ? (
                          <div className="mt-2 border-t border-black/10 pt-2">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">
                              Tarjeta por tipo
                            </p>
                            {(corte.tarjetaPorTipo ?? []).map((t) => (
                              <div key={t.tipo ?? t.etiqueta} className="flex justify-between text-black/60">
                                <span>{t.etiqueta}</span>
                                <span className="font-medium">{formatMoney(t.monto)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {/* Cada renglón corresponde al depósito de una terminal:
                            es lo que se compara contra el estado de cuenta del banco. */}
                        {(corte.tarjetaPorTerminal ?? []).length > 0 ? (
                          <div className="mt-2 border-t border-black/10 pt-2">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">
                              Tarjeta por terminal
                            </p>
                            {(corte.tarjetaPorTerminal ?? []).map((t) => (
                              <div key={t.terminalId ?? t.alias} className="flex justify-between text-black/60">
                                <span>{t.alias}</span>
                                <span className="font-medium">{formatMoney(t.monto)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {corte.totalVentasDolaresUsd ? (
                          <div className="mt-2 flex justify-between border-t border-black/10 pt-2 text-sky-800">
                            <span>Dólares recibidos en ventas</span>
                            <span className="font-medium">
                              {formatDolares(corte.totalVentasDolaresUsd)} (
                              {formatMoney(corte.totalVentasDolaresMxn ?? 0)})
                            </span>
                          </div>
                        ) : null}
                        <div className="mt-2 flex justify-between border-t border-black/10 pt-2 text-sky-800">
                          <span>Dólares esperado / contado</span>
                          <span className="font-medium">
                            {formatDolares(corte.efectivoEsperadoUsd ?? 0)} /{" "}
                            {formatDolares(corte.efectivoContadoUsd ?? 0)}
                          </span>
                        </div>
                        {corte.notas ? <p className="pt-2 text-xs text-black/50">Notas: {corte.notas}</p> : null}
                      </div>

                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">
                          <Banknote className="h-3.5 w-3.5" /> Retiros del turno ({corte.retiros.length})
                        </p>
                        {corte.retiros.length === 0 ? (
                          <EmptyState message="Sin retiros en este turno." />
                        ) : (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-black/10 text-black/50">
                                <th className="py-1.5 pr-2">Folio</th>
                                <th className="py-1.5 pr-2">Hora</th>
                                <th className="py-1.5 pr-2">Autorizó</th>
                                <th className="py-1.5 pr-2">Motivo</th>
                                <th className="py-1.5 pl-2 text-right">Monto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {corte.retiros.map((r) => (
                                <tr key={r._id} className="border-b border-black/5">
                                  <td className="py-1.5 pr-2 font-mono text-xs">{r.folio}</td>
                                  <td className="py-1.5 pr-2 text-black/60">
                                    {formatHora(r.fecha, zonaDelCorte(corte))}
                                  </td>
                                  <td className="py-1.5 pr-2 text-black/60">{r.usuarioNombre || "—"}</td>
                                  <td className="py-1.5 pr-2 text-black/60">{r.motivo}</td>
                                  <td className="py-1.5 pl-2 text-right font-semibold whitespace-nowrap">
                                    {r.moneda === "USD" ? `${formatDolares(r.monto)} USD` : formatMoney(r.monto)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
