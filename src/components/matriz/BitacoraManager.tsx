"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, User } from "lucide-react";
import { Card, Input, Select, EmptyState, FormField, formatMoney } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaLarga, formatHora } from "@/lib/zonasHorarias";

const TIPOS = [
  { valor: "cancelacion", etiqueta: "Cancelaciones" },
  { valor: "devolucion", etiqueta: "Devoluciones" },
  { valor: "retiro", etiqueta: "Retiros" },
  { valor: "surtido", etiqueta: "Surtidos" },
  { valor: "recepcion", etiqueta: "Recepciones" },
  { valor: "prestamo", etiqueta: "Préstamos" },
] as const;

const COLOR_TIPO: Record<string, string> = {
  cancelacion: "bg-red-100 text-red-700",
  devolucion: "bg-amber-100 text-amber-800",
  retiro: "bg-titos-orange-100 text-titos-orange-700",
  surtido: "bg-sky-100 text-sky-800",
  recepcion: "bg-titos-green-100 text-titos-green-700",
  prestamo: "bg-black/5 text-black/60",
};

const ETIQUETA_TIPO: Record<string, string> = {
  cancelacion: "Cancelación",
  devolucion: "Devolución",
  retiro: "Retiro",
  surtido: "Surtido",
  recepcion: "Recepción",
  prestamo: "Préstamo",
};

type ItemEvento = {
  nombreProducto: string;
  cantidad: number;
  unidad: string;
  importe: number;
};

type Evento = {
  id: string;
  tipo: string;
  fecha: string;
  folio: string;
  sucursalNombre: string;
  usuarioNombre: string;
  descripcion: string;
  detalle: string;
  importe: number | null;
  items?: ItemEvento[];
};

/** Los kilos llevan decimales; las piezas, no. */
function cantidadTexto(item: ItemEvento) {
  const cantidad = item.unidad === "kg" ? item.cantidad.toFixed(3) : String(item.cantidad);
  return `${cantidad}${item.unidad ? ` ${item.unidad}` : ""}`;
}

type Catalogo = { _id: string; nombre: string };

function haceDias(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export function BitacoraManager() {
  const zonaHoraria = useZonaHoraria();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [sucursales, setSucursales] = useState<Catalogo[]>([]);
  const [usuarios, setUsuarios] = useState<Catalogo[]>([]);
  const [cargando, setCargando] = useState(true);

  const [desde, setDesde] = useState(haceDias(7));
  const [hasta, setHasta] = useState(hoy());
  const [sucursalId, setSucursalId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (usuarioId) params.set("usuarioId", usuarioId);
    if (tipos.length > 0) params.set("tipos", tipos.join(","));

    const res = await fetch(`/api/bitacora?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setEventos(data.eventos ?? []);
      setSucursales(data.sucursales ?? []);
      setUsuarios(data.usuarios ?? []);
    }
    setCargando(false);
  }, [desde, hasta, sucursalId, usuarioId, tipos]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar los filtros
    cargar();
  }, [cargar]);

  function alternarTipo(valor: string) {
    setTipos((prev) => (prev.includes(valor) ? prev.filter((t) => t !== valor) : [...prev, valor]));
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </FormField>
          <FormField label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </FormField>
          <FormField label="Sucursal">
            <Select icon={Store} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Usuario">
            <Select icon={User} value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.nombre}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-black/40">Tipo</span>
          {TIPOS.map(({ valor, etiqueta }) => {
            const activo = tipos.includes(valor);
            return (
              <button
                key={valor}
                type="button"
                onClick={() => alternarTipo(valor)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  activo ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                }`}
              >
                {etiqueta}
              </button>
            );
          })}
          {tipos.length > 0 ? (
            <button
              type="button"
              onClick={() => setTipos([])}
              className="text-xs font-medium text-titos-green-700 hover:underline"
            >
              Ver todos
            </button>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">
          Movimientos ({eventos.length})
          {eventos.length >= 200 ? (
            <span className="ml-2 text-xs font-normal text-black/40">
              — mostrando los 200 más recientes, acota el rango para ver el resto
            </span>
          ) : null}
        </h2>

        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : eventos.length === 0 ? (
          <EmptyState message="No hay movimientos registrados con esos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="py-2 pr-3">Hora</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Quién</th>
                  <th className="py-2 pr-3">Sucursal</th>
                  <th className="py-2 pr-3">Qué hizo</th>
                  <th className="py-2 pr-3 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id} className="border-b border-black/5 align-top">
                    {/* La hora va en grande y aparte de la fecha: al auditar una
                        cancelación lo primero que se cruza es contra el turno. */}
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="block font-semibold text-black/70">{formatHora(e.fecha, zonaHoraria)}</span>
                      <span className="block text-xs text-black/40">{formatFechaLarga(e.fecha, zonaHoraria)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                          COLOR_TIPO[e.tipo] ?? "bg-black/5 text-black/60"
                        }`}
                      >
                        {ETIQUETA_TIPO[e.tipo] ?? e.tipo}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-medium">{e.usuarioNombre || "—"}</td>
                    <td className="py-2 pr-3 text-black/60">{e.sucursalNombre || "—"}</td>
                    <td className="py-2 pr-3">
                      {e.descripcion}
                      <span className="block text-xs text-black/40">
                        {e.folio}
                        {e.detalle ? ` · ${e.detalle}` : ""}
                      </span>
                      {/* Desglose de los productos: en una cancelación parcial es
                          lo único que dice qué se quitó y cuánto. */}
                      {(e.items ?? []).length > 0 ? (
                        <ul className="mt-1 space-y-0.5 border-l-2 border-black/10 pl-2">
                          {(e.items ?? []).map((i, idx) => (
                            <li key={idx} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                              <span className="font-medium text-black/70">{i.nombreProducto || "Producto"}</span>
                              <span className="text-black/50">× {cantidadTexto(i)}</span>
                              <span className="text-black/40">{formatMoney(i.importe)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-medium">
                      {e.importe == null ? "—" : formatMoney(e.importe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
