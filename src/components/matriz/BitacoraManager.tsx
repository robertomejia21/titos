"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, User } from "lucide-react";
import { Card, Input, Select, EmptyState, FormField, Pagination, formatMoney } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
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
  const { pagina, paginacion } = usePaginacion(eventos, [desde, hasta, sucursalId, usuarioId, tipos.join(",")].join("|"));

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
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Hora</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Fecha</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Tipo</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Quién</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Sucursal</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Folio</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Qué hizo</th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium">Importe</th>
                </tr>
              </thead>
              <tbody>
                {pagina.map((e) => {
                  const items = e.items ?? [];
                  const que = `${e.descripcion}${e.detalle ? ` · ${e.detalle}` : ""}`;
                  // Desglose de los productos: en una cancelación parcial es
                  // lo único que dice qué se quitó y cuánto.
                  const desglose = items
                    .map((i) => `${i.nombreProducto || "Producto"} × ${cantidadTexto(i)} · ${formatMoney(i.importe)}`)
                    .join("\n");
                  return (
                  <tr key={e.id} className="border-b border-black/5">
                    {/* La hora va resaltada y aparte de la fecha: al auditar una
                        cancelación lo primero que se cruza es contra el turno. */}
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-black/70">
                      {formatHora(e.fecha, zonaHoraria)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-black/40">
                      {formatFechaLarga(e.fecha, zonaHoraria)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                          COLOR_TIPO[e.tipo] ?? "bg-black/5 text-black/60"
                        }`}
                      >
                        {ETIQUETA_TIPO[e.tipo] ?? e.tipo}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{e.usuarioNombre || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{e.sucursalNombre || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs text-black/40">{e.folio || "—"}</td>
                    <td className="px-2 py-1.5">
                      {/* El desglose se despliega con clic (no solo tooltip) para
                          que también se pueda consultar desde una tablet. */}
                      <details className="group max-w-[24rem]">
                        <summary className={`flex items-center gap-1.5 ${items.length > 0 ? "cursor-pointer" : "pointer-events-none"} list-none`}>
                          <span className="truncate" title={desglose ? `${que}\n${desglose}` : que}>
                            {que}
                          </span>
                          {items.length > 0 ? (
                            <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-xs text-black/60 group-open:bg-titos-green-100 group-open:text-titos-green-800">
                              {items.length} {items.length === 1 ? "producto" : "productos"}
                            </span>
                          ) : null}
                        </summary>
                        {items.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 border-l-2 border-black/10 pl-2 text-xs text-black/70">
                            {items.map((i, idx) => (
                              <li key={idx}>{i.nombreProducto || "Producto"} × {cantidadTexto(i)} · {formatMoney(i.importe)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </details>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                      {e.importe == null ? "—" : formatMoney(e.importe)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacion} />
          </>
        )}
      </Card>
    </div>
  );
}
