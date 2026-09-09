"use client";

import { useRef, useState } from "react";
import { Button, FormField, Input, Modal, formatMoney } from "@/components/ui";
import type { ResumenSesion } from "@/lib/caja";
import { leerCola } from "@/lib/offlinePos";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";

type Resultado = {
  _id: string; token?: string; supervisorNombre: string; consultadoEn: string;
  estado: "consulta" | "guardado"; resumen: ResumenSesion;
  efectivoInicial: number; efectivoInicialUsd: number;
  efectivoEsperado: number; efectivoEsperadoUsd: number;
  efectivoContado?: number; efectivoContadoUsd?: number; diferencia?: number; diferenciaUsd?: number;
  recientes?: { _id: string; supervisorNombre: string; guardadoEn: string; diferencia: number; diferenciaUsd: number; notas: string }[];
};
const dinero = (n: number, moneda = "MXN") => `${formatMoney(n)} ${moneda}`;
const diferencia = (n: number, moneda: string) => `${n < 0 ? "Faltante" : n > 0 ? "Sobrante" : "Sin diferencia"}: ${dinero(Math.abs(n), moneda)}`;

export function ArqueoModal({ onClose }: { onClose: () => void }) {
  const zonaHoraria = useZonaHoraria();
  const [nip, setNip] = useState("");
  const [datos, setDatos] = useState<Resultado | null>(null);
  const [pesos, setPesos] = useState("");
  const [dolares, setDolares] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  async function enviar(accion: "consultar" | "guardar") {
    if (enCurso.current) return;
    setError("");
    if (!navigator.onLine || leerCola().length) { setError("Conecta el equipo y espera a que se sincronicen las operaciones pendientes antes del arqueo."); return; }
    if (accion === "guardar" && (!pesos.trim() || !dolares.trim())) { setError("Captura ambos conteos; usa cero si no hay efectivo en esa moneda."); return; }
    enCurso.current = true; setOcupado(true);
    try {
      const res = await fetch("/api/caja/arqueo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(accion === "consultar" ? { accion, nip } : { accion, id: datos?._id, token: datos?.token, efectivoContado: Number(pesos), efectivoContadoUsd: Number(dolares), notas }) });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409) { setDatos(null); setPesos(""); setDolares(""); }
        throw new Error(body.error || "No se pudo completar el arqueo");
      }
      setDatos(body); setNip("");
    } catch (e) { setError(e instanceof Error ? e.message : "Revisa la conexión e intenta nuevamente."); }
    finally { enCurso.current = false; setOcupado(false); }
  }
  const r = datos?.resumen;
  return <Modal open onClose={() => { if (!enCurso.current) onClose(); }} title="Arqueo de caja" size="lg">
    <p className="mb-4 text-sm text-black/70">Revisión del supervisor. La caja permanece abierta y el arqueo no modifica sus movimientos.</p>
    {!datos ? <form onSubmit={(e) => { e.preventDefault(); void enviar("consultar"); }}>
      <FormField label="NIP personal del supervisor"><Input aria-label="NIP personal del supervisor" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={nip} onChange={(e) => setNip(e.target.value.replace(/\D/g, ""))} autoFocus /></FormField>
      <Button type="submit" disabled={ocupado || nip.length !== 6} className="mt-3">{ocupado ? "Consultando..." : "Consultar arqueo"}</Button>
    </form> : <>
      <p className="mb-3 text-sm">Supervisor: <strong>{datos.supervisorNombre}</strong><br />Consulta: {formatFechaHora(datos.consultadoEn, zonaHoraria)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
        {([
          ["Fondo inicial", datos.efectivoInicial], ["Ventas en efectivo", r!.totalVentasEfectivo],
          ["Abonos en efectivo", r!.totalAbonosEfectivo], ["Abonos por otros medios", r!.totalAbonosOtros], ["Devoluciones en efectivo", r!.totalDevoluciones],
          ["Retiros en pesos", r!.totalRetiros], ["Cambio en pesos por cobros en dólares", r!.totalCambioDolaresMxn],
          ["Tarjetas", r!.totalVentasTarjeta], ["Transferencias", r!.totalVentasTransferencia],
          ["Vales", r!.totalVentasVales], ["Ventas a crédito", r!.totalVentasCredito],
        ] as [string, number][]).map(([nombre, monto]) => <div key={nombre} className="contents"><dt>{nombre}</dt><dd className="text-right">{dinero(monto)}</dd></div>)}
        <dt>Fondo inicial en dólares</dt><dd>{dinero(datos.efectivoInicialUsd, "USD")}</dd>
        <dt>Dólares recibidos por ventas</dt><dd>{dinero(r!.totalVentasDolaresUsd, "USD")}</dd>
        <dt>Retiros en dólares</dt><dd>{dinero(r!.totalRetirosUsd, "USD")}</dd>
        <dt className="font-semibold">Efectivo esperado en pesos</dt><dd className="font-semibold">{dinero(datos.efectivoEsperado)}</dd>
        <dt className="font-semibold">Efectivo esperado en dólares</dt><dd className="font-semibold">{dinero(datos.efectivoEsperadoUsd, "USD")}</dd>
      </dl>
      <p className="my-3 text-xs text-black/70">Tarjetas, transferencias, vales y crédito se muestran por separado; no forman parte del efectivo esperado.</p>
      {datos.recientes?.length ? <details className="my-3 text-sm"><summary className="cursor-pointer font-medium">Últimos arqueos guardados de esta caja</summary>
        <ul className="mt-2 space-y-2">{datos.recientes.map((a) => <li key={a._id} className="border-t border-black/10 pt-2">
          <p>{formatFechaHora(a.guardadoEn, zonaHoraria)} · {a.supervisorNombre}</p>
          <p>{diferencia(a.diferencia, "MXN")} · {diferencia(a.diferenciaUsd, "USD")}</p>
          {a.notas ? <p className="whitespace-pre-wrap">{a.notas}</p> : null}
        </li>)}</ul>
      </details> : null}
      {datos.estado === "guardado" ? <div role="status" className="mt-4 rounded-lg bg-titos-green-100 p-3 text-sm text-titos-green-900">
        <p className="font-semibold">Arqueo guardado. La caja sigue abierta.</p>
        <p>Contado: {dinero(datos.efectivoContado!)} · {dinero(datos.efectivoContadoUsd!, "USD")}</p>
        <p>{diferencia(datos.diferencia!, "MXN")}</p><p>{diferencia(datos.diferenciaUsd!, "USD")}</p>
      </div> : <form onSubmit={(e) => { e.preventDefault(); void enviar("guardar"); }} className="mt-4 space-y-3">
        <p className="text-sm text-black/70">Cuenta el efectivo sin realizar cobros en este equipo. Si cambia la caja, tendrás que consultar de nuevo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Pesos contados"><Input aria-label="Pesos contados" type="number" min="0" max="1000000000" step="0.01" required value={pesos} onChange={(e) => setPesos(e.target.value)} /></FormField>
          <FormField label="Dólares contados"><Input aria-label="Dólares contados" type="number" min="0" max="1000000000" step="0.01" required value={dolares} onChange={(e) => setDolares(e.target.value)} /></FormField>
        </div>
        {pesos !== "" && Number.isFinite(Number(pesos)) ? <p className="text-sm">{diferencia(Number((Number(pesos) - datos.efectivoEsperado).toFixed(2)), "MXN")}</p> : null}
        {dolares !== "" && Number.isFinite(Number(dolares)) ? <p className="text-sm">{diferencia(Number((Number(dolares) - datos.efectivoEsperadoUsd).toFixed(2)), "USD")}</p> : null}
        <FormField label="Observaciones"><textarea aria-label="Observaciones del arqueo" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} className="w-full rounded-lg border border-black/20 p-2 focus-visible:outline-2 focus-visible:outline-titos-green-600" /></FormField>
        <Button type="submit" disabled={ocupado}>{ocupado ? "Guardando..." : "Guardar arqueo sin cerrar caja"}</Button>
      </form>}
    </>}
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    <div className="mt-4 flex justify-end"><Button variant="ghost" disabled={ocupado} onClick={onClose}>Volver al punto de venta</Button></div>
  </Modal>;
}
