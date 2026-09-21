"use client";

import { useMemo, useState } from "react";
import { Card, Pagination } from "@/components/ui";
import { ExportarExcelButton } from "@/components/ExportarExcelButton";

type Fila = {
  sucursal: string;
  producto: string;
  pedido: number;
  asignado: number;
  surtido: number;
  recibido: number;
};

const PAGE_SIZE = 15;

function formatCantidad(n: number) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(n);
}

export function ReportesManager({ filas }: { filas: Fila[] }) {
  const [page, setPage] = useState(1);

  const totales = useMemo(
    () =>
      filas.reduce(
        (acc, f) => ({
          pedido: acc.pedido + f.pedido,
          asignado: acc.asignado + f.asignado,
          surtido: acc.surtido + f.surtido,
          recibido: acc.recibido + f.recibido,
        }),
        { pedido: 0, asignado: 0, surtido: 0, recibido: 0 }
      ),
    [filas]
  );

  const totalPages = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const filasPagina = filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-sm text-black/50">Total pedido</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-900">{formatCantidad(totales.pedido)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Total nivelado/asignado</p>
          <p className="mt-1 text-2xl font-bold text-sky-700">{formatCantidad(totales.asignado)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Total surtido</p>
          <p className="mt-1 text-2xl font-bold text-titos-orange-600">{formatCantidad(totales.surtido)}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Total recibido</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-700">{formatCantidad(totales.recibido)}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-black/70">{filas.length} registros. El Excel incluye todas las páginas.</p>
          <ExportarExcelButton disabled={!filas.length} crearReporte={() => ({
            nombre: "titos-comparativo-pedidos",
            filtros: [["Reporte", "Comparativo de pedidos, asignación, surtido y recepción"], ["Alcance", "Todos los pedidos consultados que ya no están pendientes"]],
            hojas: [
              { nombre: "Resumen", columnas: ["Concepto", "Cantidad"], filas: [["Pedido", totales.pedido], ["Asignado", totales.asignado], ["Surtido", totales.surtido], ["Recibido", totales.recibido]] },
              { nombre: "Comparativo", columnas: ["Sucursal", "Producto", "Pedido", "Asignado (Nivelador)", "Surtido", "Recibido", "Diferencia pedido vs. asignado"],
                filas: filas.map(f => [f.sucursal, f.producto, f.pedido, f.asignado, f.surtido, f.recibido, Math.min(0, f.asignado - f.pedido)]) },
            ],
          })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-black/50">
                <th className="py-2 pr-2">Sucursal</th>
                <th className="py-2 pr-2">Producto</th>
                <th className="py-2 pr-2">Pedido</th>
                <th className="py-2 pr-2">Asignado (Nivelador)</th>
                <th className="py-2 pr-2">Surtido</th>
                <th className="py-2 pr-2">Recibido</th>
                <th className="py-2 pr-2">Diferencia pedido vs. asignado</th>
              </tr>
            </thead>
            <tbody>
              {filasPagina.map((f, i) => (
                <tr key={(page - 1) * PAGE_SIZE + i} className="border-b border-black/5">
                  <td className="py-2 pr-2">{f.sucursal}</td>
                  <td className="py-2 pr-2 font-medium">{f.producto}</td>
                  <td className="py-2 pr-2">{formatCantidad(f.pedido)}</td>
                  <td className="py-2 pr-2">{formatCantidad(f.asignado)}</td>
                  <td className="py-2 pr-2">{formatCantidad(f.surtido)}</td>
                  <td className="py-2 pr-2">{formatCantidad(f.recibido)}</td>
                  <td className="py-2 pr-2">
                    {f.pedido - f.asignado > 0 ? (
                      <span className="text-amber-600">-{formatCantidad(f.pedido - f.asignado)}</span>
                    ) : (
                      <span className="text-black/30">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={filas.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </Card>
    </>
  );
}
