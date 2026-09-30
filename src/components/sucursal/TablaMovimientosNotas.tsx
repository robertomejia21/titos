"use client";
import { Pagination, formatMoney } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";

export type MovimientoNota = {
  id: string;
  /** Fecha ya formateada en la zona horaria de la sucursal. */
  fecha: string;
  folio: string;
  secuenciaEfectivo: number | null;
  total: number;
  estado: string;
};

/** Movimientos de un lapso de Notas de venta, paginados a 20 renglones. */
export function TablaMovimientosNotas({ movimientos }: { movimientos: MovimientoNota[] }) {
  const { pagina, paginacion } = usePaginacion(movimientos);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/50">
              <th className="px-2 py-1.5 text-xs font-medium">Hora</th>
              <th className="px-2 py-1.5 text-xs font-medium">Folio</th>
              <th className="px-2 py-1.5 text-xs font-medium">Secuencia</th>
              <th className="px-2 py-1.5 text-right text-xs font-medium">Monto</th>
              <th className="px-2 py-1.5 text-xs font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {pagina.map((mov) => (
              <tr key={mov.id} className="border-b border-black/5">
                <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{mov.fecha}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-medium text-titos-green-900">{mov.folio}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-black/60">
                  {mov.secuenciaEfectivo ? `${mov.secuenciaEfectivo}a venta en efectivo` : "-"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{formatMoney(mov.total)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">{mov.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...paginacion} />
    </>
  );
}
