"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Card, EmptyState, FormField, Pagination, Select, formatMoney } from "@/components/ui";
import { FiltrosSucursalFecha, fechaISO, type SucursalFiltro } from "@/components/matriz/FiltrosSucursalFecha";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";

type ItemCancelado = {
  sku: string;
  nombreProducto: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  importe: number;
};

type Cancelacion = {
  _id: string;
  folio: string;
  tipo: "linea" | "carrito" | "venta";
  sucursalNombre: string;
  esMatriz: boolean;
  usuarioNombre: string;
  ventaFolio: string;
  items: ItemCancelado[];
  importe: number;
  motivo: string;
  autorizadoConNip: boolean;
  fecha: string | null;
  corte: string;
};

const ETIQUETA_TIPO: Record<Cancelacion["tipo"], string> = {
  linea: "Producto quitado",
  carrito: "Venta en curso",
  venta: "Venta cobrada",
};

const CLASE_TIPO: Record<Cancelacion["tipo"], string> = {
  linea: "bg-amber-100 text-amber-800",
  carrito: "bg-sky-100 text-sky-800",
  venta: "bg-red-100 text-red-700",
};

const PAGE_SIZE = 20;

export function CancelacionesManager() {
  const zonaHoraria = useZonaHoraria();
  const [sucursales, setSucursales] = useState<SucursalFiltro[]>([]);
  const [cancelaciones, setCancelaciones] = useState<Cancelacion[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [desde, setDesde] = useState(() => fechaISO(30));
  const [hasta, setHasta] = useState(() => fechaISO());
  const [tipo, setTipo] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandido, setExpandido] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (tipo) params.set("tipo", tipo);

    const res = await fetch(`/api/cancelaciones?${params.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    setCancelaciones(await res.json());
    setPage(1);
  }, [sucursalId, desde, hasta, tipo]);

  useEffect(() => {
    fetch("/api/sucursales")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: SucursalFiltro[]) => setSucursales(data))
      .catch(() => setSucursales([]));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga la bitácora cuando cambian los filtros
    cargar();
  }, [cargar]);

  const totales = useMemo(() => {
    const sinAutorizar = cancelaciones.filter((c) => !c.autorizadoConNip).length;
    return {
      cantidad: cancelaciones.length,
      importe: cancelaciones.reduce((sum, c) => sum + c.importe, 0),
      ventasCanceladas: cancelaciones.filter((c) => c.tipo === "venta").length,
      sinAutorizar,
    };
  }, [cancelaciones]);

  const totalPages = Math.max(1, Math.ceil(cancelaciones.length / PAGE_SIZE));
  const pagina = cancelaciones.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        <FormField label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="linea">Producto quitado del carrito</option>
            <option value="carrito">Venta en curso cancelada</option>
            <option value="venta">Venta ya cobrada</option>
          </Select>
        </FormField>
      </FiltrosSucursalFecha>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-sm text-black/50">Cancelaciones</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-900">{totales.cantidad}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Importe cancelado</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{formatMoney(totales.importe)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Ventas ya cobradas</p>
          <p className="mt-1 text-2xl font-bold text-titos-orange-600">{totales.ventasCanceladas}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Sin NIP de supervisor</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{totales.sinAutorizar}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Bitácora</h2>
          <Button variant="ghost" onClick={cargar} disabled={loading}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </span>
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : cancelaciones.length === 0 ? (
          <EmptyState message="No hay cancelaciones registradas en el periodo seleccionado." />
        ) : (
          <>
            <ul className="divide-y divide-black/5">
              {pagina.map((c) => {
                const abierto = expandido === c._id;
                return (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => setExpandido(abierto ? null : c._id)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-left text-sm hover:bg-black/2"
                    >
                      <span className="flex items-center gap-2 font-medium text-titos-green-900">
                        {abierto ? (
                          <ChevronDown className="h-4 w-4 text-black/30" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-black/30" />
                        )}
                        {c.folio}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASE_TIPO[c.tipo]}`}>
                        {ETIQUETA_TIPO[c.tipo]}
                      </span>
                      <span className="text-black/60">{c.sucursalNombre || "—"}</span>
                      <span className="text-xs text-black/45">{formatFechaHora(c.fecha, zonaHoraria, "—")}</span>
                      <span className="text-xs text-black/60">{c.usuarioNombre || "—"}</span>
                      <span className="font-semibold text-red-600">{formatMoney(c.importe)}</span>
                      {c.autorizadoConNip ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-titos-green-700">
                          <ShieldCheck className="h-3.5 w-3.5" /> Autorizada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                          <ShieldAlert className="h-3.5 w-3.5" /> Sin NIP
                        </span>
                      )}
                    </button>

                    {abierto ? (
                      <div className="pb-4 text-sm">
                        <p className="mb-3 rounded-lg bg-black/2 px-3 py-2 text-black/70">
                          <span className="font-medium">Motivo:</span> {c.motivo}
                          {c.ventaFolio ? (
                            <span className="ml-2 text-black/45">· Venta {c.ventaFolio}</span>
                          ) : null}
                        </p>
                        {c.items.length > 0 ? (
                          <ul className="divide-y divide-black/5 rounded-lg bg-black/2 px-3">
                            {c.items.map((i, idx) => (
                              <li key={idx} className="flex items-center justify-between py-1.5">
                                <span>
                                  {i.nombreProducto} × {i.cantidad} {i.unidad}
                                </span>
                                <span className="font-medium">{formatMoney(i.importe)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={cancelaciones.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
