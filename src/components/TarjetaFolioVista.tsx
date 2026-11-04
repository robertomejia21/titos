"use client";

import type { ReactNode } from "react";
import { Card, EstadoBadge, formatMoney } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { categoriaLabel } from "@/lib/categorias";
import { ESTADO_CAJA_LABEL, ETAPA_CARGA_LABEL, PUNTOS_ESCANEO, PUNTO_ESCANEO_LABEL, TIPO_EVENTO_LABEL, TIPO_INCIDENCIA_LABEL, type TipoIncidencia } from "@/lib/logistica";
import type { EscaneoVista, TarjetaFolio } from "@/lib/tarjetaFolio";

const ESTADO_SALIDA_LABEL: Record<string, string> = { programada: "Programada", en_ruta: "En ruta", completada: "Completada" };

const CLASE_CAJA = {
  armada: "bg-amber-100 text-amber-800",
  cerrada: "bg-sky-100 text-sky-800",
  sellada: "bg-titos-green-100 text-titos-green-700",
} as const;

/** Dónde ya se leyó el QR: carga, acomodo, recepción (y si llegó a otra tienda). */
function Escaneos({ escaneos, fecha }: { escaneos: EscaneoVista[]; fecha: (iso: string | null) => string | null }) {
  const error = escaneos.find((e) => e.resultado !== "ok");
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
      {PUNTOS_ESCANEO.map((p) => {
        const hecho = escaneos.find((e) => e.punto === p && e.resultado === "ok");
        return (
          <span key={p} className={`rounded-full px-2 py-0.5 ${hecho ? "bg-titos-green-100 text-titos-green-700" : "bg-black/5 text-black/40"}`} title={hecho ? `${hecho.porNombre} · ${fecha(hecho.en)}` : "Sin escanear"}>
            {hecho ? "✓ " : ""}
            {PUNTO_ESCANEO_LABEL[p]}
            {hecho ? ` · ${fecha(hecho.en)}` : ""}
          </span>
        );
      })}
      {error ? <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Se escaneó en otra sucursal</span> : null}
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-black/45">{etiqueta}</p>
      <div className="truncate text-sm font-semibold text-black/80">{children}</div>
    </div>
  );
}

/**
 * Tarjeta digital del folio; `acciones` la deja operar desde el CEDIS. La
 * tienda ya ve el contenido en su tabla de recepción, por eso lo puede ocultar.
 */
export function TarjetaFolioVista({ tarjeta, acciones, sinContenido = false }: { tarjeta: TarjetaFolio; acciones?: ReactNode; sinContenido?: boolean }) {
  const zona = useZonaHoraria();
  const fecha = (iso: string | null) => (iso ? formatFechaHora(iso, zona) : null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Folio</p>
            <h2 className="text-2xl font-bold text-titos-green-900">
              {tarjeta.folio}
              {tarjeta.vuelta === 2 ? <span className="ml-2 rounded bg-titos-orange-100 px-1.5 align-middle text-xs font-semibold text-titos-orange-700">Segunda vuelta</span> : null}
            </h2>
            <p className="text-sm text-black/60">
              Para <strong>{tarjeta.sucursalNombre}</strong> · corte {tarjeta.corte}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EstadoBadge estado={tarjeta.estado} />
            <span className="rounded-full bg-titos-green-100 px-2.5 py-0.5 text-xs font-semibold text-titos-green-700">{ETAPA_CARGA_LABEL[tarjeta.etapa]}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-black/5 pt-4 sm:grid-cols-4">
          <Dato etiqueta="Salida">{tarjeta.salida ? `${tarjeta.salida.nombre}` : "Sin salida"}</Dato>
          <Dato etiqueta="Hora de salida">{tarjeta.salida ? `${tarjeta.salida.fecha} ${tarjeta.salida.horaSalida}` : "—"}</Dato>
          <Dato etiqueta="Unidad">{tarjeta.salida?.vehiculo || "—"}</Dato>
          <Dato etiqueta="Estado de la salida">{tarjeta.salida ? (ESTADO_SALIDA_LABEL[tarjeta.salida.estado] ?? tarjeta.salida.estado) : "—"}</Dato>
        </div>
        {tarjeta.salida?.paradas.length ? <p className="mt-2 text-xs text-black/50">Ruta: {tarjeta.salida.paradas.join(" → ")}</p> : null}
      </Card>

      {acciones ? (
        <Card>
          <h3 className="mb-2 font-semibold text-titos-green-900">Carga y salida</h3>
          {acciones}
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-3 font-semibold text-titos-green-900">Responsables</h3>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tarjeta.responsables.map((r) => (
            <li key={r.rol} className="rounded-lg bg-black/2 px-3 py-2">
              <p className="text-xs font-medium text-black/45">{r.rol}</p>
              <p className="text-sm font-semibold text-black/80">{r.nombre || "—"}</p>
              {r.en ? <p className="text-xs text-black/45">{fecha(r.en)}</p> : null}
              {r.nota ? <p className="text-xs text-amber-700">{r.nota}</p> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-titos-green-900">Cajas ({tarjeta.cajas.length})</h3>
        {tarjeta.cajas.length === 0 ? (
          <p className="text-sm text-black/40">Este folio no lleva cajas registradas (frutas, verduras y carnicería van directo).</p>
        ) : (
          <ul className="space-y-2">
            {tarjeta.cajas.map((c) => (
              <li key={c.numero} className="rounded-lg border border-black/5 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Caja {c.numero}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASE_CAJA[c.estado]}`}>{ESTADO_CAJA_LABEL[c.estado]}</span>
                  {c.categoria ? <span className="text-xs capitalize text-black/45">{categoriaLabel(c.categoria)}</span> : null}
                  {c.cinchos ? <span className="font-mono text-xs text-black/55">cinchos {c.cinchos}</span> : null}
                </div>
                <p className="mt-1 text-black/70">{c.contenido}</p>
                <Escaneos escaneos={c.escaneos} fecha={fecha} />
              </li>
            ))}
          </ul>
        )}
        {tarjeta.cajas.length === 0 && tarjeta.escaneosFolio.length ? <Escaneos escaneos={tarjeta.escaneosFolio} fecha={fecha} /> : null}
      </Card>

      {tarjeta.incidencias.length ? (
        <Card className="border-l-4 border-l-red-500">
          <h3 className="mb-2 font-semibold text-titos-green-900">Incidencias ({tarjeta.incidencias.length})</h3>
          <ul className="space-y-2 text-sm">
            {tarjeta.incidencias.map((i) => (
              <li key={i._id}>
                <p>
                  <strong>{TIPO_INCIDENCIA_LABEL[i.tipo as TipoIncidencia] ?? i.tipo}</strong>
                  {i.cajaNumero ? ` · caja ${i.cajaNumero}` : ""}
                  {i.sucursalDetecto ? ` · en ${i.sucursalDetecto}` : ""}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${i.estado === "abierta" ? "bg-red-100 text-red-700" : "bg-titos-green-100 text-titos-green-700"}`}>
                    {i.estado === "abierta" ? "Abierta" : "Resuelta"}
                  </span>
                </p>
                <p className="text-black/60">{i.comentarios.at(-1)?.texto}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sinContenido ? null : (
      <Card>
        <h3 className="mb-3 font-semibold text-titos-green-900">Contenido</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs text-black/50">
                <th className="px-2 py-1.5 font-medium">Producto</th>
                <th className="px-2 py-1.5 text-right font-medium">Pedido</th>
                <th className="px-2 py-1.5 text-right font-medium">Surtido</th>
                <th className="px-2 py-1.5 text-right font-medium">Recibido</th>
                {tarjeta.verMontos ? <th className="px-2 py-1.5 text-right font-medium">Subtotal</th> : null}
              </tr>
            </thead>
            <tbody>
              {tarjeta.items.map((i) => (
                <tr key={i.nombre} className="border-b border-black/5">
                  <td className="px-2 py-1.5 font-medium">{i.nombre}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {i.pedido} {i.unidad}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {i.surtido ?? "—"}
                    {i.peso ? ` (${i.peso} kg)` : ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{i.recibido ?? "—"}</td>
                  {tarjeta.verMontos ? <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatMoney(i.subtotal ?? 0)}</td> : null}
                </tr>
              ))}
            </tbody>
            {tarjeta.verMontos ? (
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-2 pt-2 text-right text-xs font-semibold uppercase text-black/40">
                    Total
                  </td>
                  <td className="px-2 pt-2 text-right font-semibold text-titos-green-900">{formatMoney(tarjeta.total)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>
      )}

      <Card>
        <h3 className="mb-3 font-semibold text-titos-green-900">Historial</h3>
        {tarjeta.historial.length === 0 ? (
          <p className="text-sm text-black/40">Este folio es anterior a la tarjeta digital: no tiene historial detallado.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-titos-green-100 pl-4">
            {tarjeta.historial.map((e, i) => (
              <li key={`${e.en}-${i}`} className="text-sm">
                <p>
                  <strong>{TIPO_EVENTO_LABEL[e.tipo] ?? e.tipo}</strong>
                  {e.detalle ? <span className="text-black/65"> · {e.detalle}</span> : null}
                </p>
                <p className="text-xs text-black/45">
                  {fecha(e.en)}
                  {e.porNombre ? ` · ${e.porNombre}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
