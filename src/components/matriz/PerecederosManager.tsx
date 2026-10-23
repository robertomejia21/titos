"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, EmptyState, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { ESTADO_ROTACION_LABEL, type EstadoRotacion } from "@/lib/perecederos";

type Fila = {
  productoId: string;
  sku: string;
  nombre: string;
  linea: string;
  unidad: string;
  existencia: number;
  vidaUtilDias: number;
  estado: EstadoRotacion;
  tramos: { fecha: string | null; cantidad: number; diasEnAlmacen: number | null; estado: EstadoRotacion }[];
  cantidadEnRiesgo: number;
  diasMasViejo: number | null;
  salidaDiaria: number;
  diasCobertura: number | null;
  excedente: number;
  recomendacion: string;
};

const ESTILO: Record<EstadoRotacion, string> = {
  fresco: "bg-titos-green-100 text-titos-green-700",
  madurando: "bg-amber-100 text-amber-800",
  urgente: "bg-titos-orange-100 text-titos-orange-700",
  vencido: "bg-red-100 text-red-700",
  sin_fecha: "bg-violet-100 text-violet-800",
};

const ORDEN_FILTROS: (EstadoRotacion | "todos" | "atencion")[] = ["atencion", "todos", "vencido", "urgente", "sin_fecha", "madurando", "fresco"];
const fmt = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 2 });

export function PerecederosManager() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [filtro, setFiltro] = useState<(typeof ORDEN_FILTROS)[number]>("atencion");

  useEffect(() => {
    fetch("/api/operacion/perecederos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFilas)
      .catch(() => setFilas([]));
  }, []);

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of filas ?? []) c[f.estado] = (c[f.estado] ?? 0) + 1;
    return c;
  }, [filas]);

  const visibles = useMemo(
    () => (filas ?? []).filter((f) => filtro === "todos" || (filtro === "atencion" ? f.estado !== "fresco" || f.excedente > 0 : f.estado === filtro)),
    [filas, filtro]
  );
  const { pagina, paginacion } = usePaginacion(visibles, filtro);

  if (!filas) return <p className="text-sm text-black/50">Cargando...</p>;

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-black/60">
        La antigüedad se estima con primeras entradas, primeras salidas: lo que queda en el CEDIS es lo último que llegó. La salida diaria es el promedio de los
        últimos 14 días (pedidos surtidos y mostrador). La vida útil de cada producto se captura en{" "}
        <Link href="/matriz/minimos" className="font-medium text-titos-green-700 underline">
          Mínimos y productos clave
        </Link>
        .
      </Card>

      <div className="flex flex-wrap gap-2">
        {ORDEN_FILTROS.map((f) => {
          const etiqueta = f === "todos" ? "Todos" : f === "atencion" ? "Requieren atención" : ESTADO_ROTACION_LABEL[f];
          const n =
            f === "todos" ? filas.length : f === "atencion" ? filas.filter((x) => x.estado !== "fresco" || x.excedente > 0).length : (conteo[f] ?? 0);
          return (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${filtro === f ? "border-titos-green-600 bg-titos-green-600 text-white" : "border-black/10 text-black/60"}`}
            >
              {etiqueta} ({n})
            </button>
          );
        })}
      </div>

      {filas.length === 0 ? (
        <EmptyState message="No hay perecederos con existencia y vida útil capturada. Captura los días de vida útil en Mínimos y productos clave." />
      ) : visibles.length === 0 ? (
        <EmptyState message="Nada en este filtro." />
      ) : (
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs text-black/50">
                  {["Producto", "Estado", "Existencia", "Lo más viejo", "Vida útil", "En riesgo", "Salida diaria", "Alcanza para", "Qué hacer"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagina.map((f) => (
                  <tr key={f.productoId} className="border-b border-black/5 align-top">
                    <td className="max-w-[16rem] px-2 py-1.5">
                      <p className="truncate font-medium" title={f.nombre}>
                        {f.nombre}
                      </p>
                      <p className="truncate text-xs text-black/40">{f.linea || f.sku}</p>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ESTILO[f.estado]}`}>{ESTADO_ROTACION_LABEL[f.estado]}</span>
                      {f.excedente > 0 ? (
                        <span className="mt-1 block w-fit whitespace-nowrap rounded-full bg-titos-orange-100 px-2 py-0.5 text-xs font-semibold text-titos-orange-700" title="Al ritmo de salida actual no alcanza a salir todo antes de pasarse">
                          Sobrestock
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {fmt(f.existencia)} {f.unidad}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.diasMasViejo === null ? "Sin fecha" : `${f.diasMasViejo} día(s)`}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.vidaUtilDias} días</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.cantidadEnRiesgo ? `${fmt(f.cantidadEnRiesgo)} ${f.unidad}` : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.salidaDiaria ? `${fmt(f.salidaDiaria)} ${f.unidad}/día` : "Sin salidas"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.diasCobertura === null ? "—" : `${f.diasCobertura} día(s)`}</td>
                    <td className="min-w-56 px-2 py-1.5 text-xs text-black/70">{f.recomendacion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacion} />
        </Card>
      )}
    </div>
  );
}
