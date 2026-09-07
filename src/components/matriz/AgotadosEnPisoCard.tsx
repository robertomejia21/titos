"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageX, TriangleAlert } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";

// Faltantes que reportó el piso de venta: productos cuya última existencia se
// acaba de vender. Compras también recibe el WhatsApp, pero esta lista es la que
// no se pierde si el mensaje no salió.

type Alerta = {
  _id: string;
  sku: string;
  nombreProducto: string;
  sucursalNombre: string;
  ventaFolio: string;
  fecha: string | null;
  stockResultante: number;
  vendidoSinExistencia: boolean;
  notificada: boolean;
  errorNotificacion: string;
};

export function AgotadosEnPisoCard() {
  const zonaHoraria = useZonaHoraria();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [atendiendo, setAtendiendo] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/alertas-inventario?estado=abierta");
    if (res.ok) setAlertas(await res.json());
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial al montar
    cargar();
  }, [cargar]);

  async function atender(id: string) {
    setAtendiendo((prev) => ({ ...prev, [id]: true }));
    const res = await fetch(`/api/alertas-inventario/${id}`, { method: "PATCH" });
    setAtendiendo((prev) => ({ ...prev, [id]: false }));
    if (res.ok) setAlertas((prev) => prev.filter((a) => a._id !== id));
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
        <PackageX className="h-4.5 w-4.5 text-red-600" />
        Agotados en piso ({alertas.length})
      </h2>
      <p className="mb-3 text-sm text-black/50">
        Productos cuya última existencia se acaba de vender. Ya entraron a las necesidades por ordenar; márcalos como
        atendidos cuando quede resuelto el resurtido.
      </p>

      {cargando ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : alertas.length === 0 ? (
        <EmptyState message="Ninguna tienda reportó agotados pendientes." />
      ) : (
        <ul className="divide-y divide-black/5">
          {alertas.map((a) => (
            <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.nombreProducto || "Producto"}
                  {/* Vendido sin existencia no es solo "se acabó": el inventario
                      quedó en negativo y además hay que ajustarlo. */}
                  {a.vendidoSinExistencia ? (
                    <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      en {a.stockResultante} · ajustar inventario
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-black/40">
                  {a.sucursalNombre || "Tienda"}
                  {a.sku ? ` · ${a.sku}` : ""}
                  {a.ventaFolio ? ` · ${a.ventaFolio}` : ""}
                  {a.fecha ? ` · ${formatFechaHora(a.fecha, zonaHoraria)}` : ""}
                </p>
                {/* Que el WhatsApp no haya salido es justo lo que hay que ver aquí. */}
                {!a.notificada ? (
                  <p className="flex items-center gap-1 text-xs font-medium text-amber-700">
                    <TriangleAlert className="h-3 w-3 shrink-0" />
                    No se avisó por WhatsApp
                    {a.errorNotificacion ? `: ${a.errorNotificacion}` : ""}
                  </p>
                ) : null}
              </div>
              <Button variant="ghost" onClick={() => atender(a._id)} disabled={atendiendo[a._id]}>
                {atendiendo[a._id] ? "Guardando..." : "Marcar atendido"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
