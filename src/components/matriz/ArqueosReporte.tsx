"use client";
import { useEffect, useState } from "react";
import { Card, Button } from "@/components/ui";
import { fechaEnZona, formatFechaHora } from "@/lib/zonasHorarias";
import { importeConSigno, resumenArqueos, type FilaArqueo } from "@/lib/reporteArqueos";
type Datos = { filas: FilaArqueo[]; resumen: ReturnType<typeof resumenArqueos>; limitado: boolean; zona: string; sucursales: { _id: string; nombre: string }[] };
const input = "min-h-11 rounded-lg border border-black/50 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-green-800";
export function ArqueosReporte() {
  const [desde, setDesde] = useState(() => fechaEnZona(new Date()));
  const [hasta, setHasta] = useState(() => fechaEnZona(new Date()));
  const [sucursal, setSucursal] = useState("");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [filtro, setFiltro] = useState("diferencias");
  const [buscar, setBuscar] = useState("");
  const [consulta, setConsulta] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const q = new URLSearchParams({ desde, hasta, sucursalId: sucursal });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de la consulta dependiente de filtros
    setCargando(true); setError("");
    fetch(`/api/reportes/arqueos?${q}`, { signal: abort.signal }).then(async (r) => {
      const json = await r.json(); if (!r.ok) throw new Error(json.error); setDatos(json);
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message || "No se pudo cargar el reporte."); }).finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => abort.abort();
  }, [desde, hasta, sucursal, consulta]);
  const filas = (datos?.filas ?? []).filter((f) => (filtro === "todos" || (filtro === "faltantes" ? f.diferencia < 0 || f.diferenciaUsd < 0 : filtro === "sobrantes" ? f.diferencia > 0 || f.diferenciaUsd > 0 : f.diferencia !== 0 || f.diferenciaUsd !== 0)) && `${f.cajero} ${f.supervisor}`.toLocaleLowerCase("es").includes(buscar.toLocaleLowerCase("es")));
  const r = datos?.resumen;
  return <Card className="mb-6">
    <h2 className="text-lg font-semibold text-titos-green-900">Diferencias en arqueos</h2>
    <p className="mt-1 text-sm text-black/75">Último arqueo guardado de cada turno dentro del periodo. Faltante (−), sobrante (+). Pesos y dólares se muestran por separado.</p>
    <div className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm">Desde<input className={input} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm">Hasta<input className={input} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm">Sucursal<select className={input} value={sucursal} onChange={(e) => setSucursal(e.target.value)}><option value="">Todas las sucursales</option>{datos?.sucursales.map((s) => <option key={s._id} value={s._id}>{s.nombre}</option>)}</select></label>
      <Button className="min-h-11 self-end" onClick={() => setConsulta((v) => v + 1)}>Actualizar arqueos</Button>
    </div>
    {error ? <p role="alert" className="text-red-800">{error}</p> : cargando ? <p role="status">Cargando arqueos...</p> : <>
      {r && <div className="mb-4 grid gap-4 rounded-lg bg-titos-green-50 p-4 sm:grid-cols-3">
        <div><p className="text-sm">Turnos con diferencias</p><strong className="text-2xl">{r.cajasConDiferencia}</strong></div>
        <div><p className="text-sm">Faltantes</p><strong>{importeConSigno(r.faltantes)} MXN</strong><p>{importeConSigno(r.faltantesUsd, "USD")} USD</p></div>
        <div><p className="text-sm">Sobrantes</p><strong>{importeConSigno(r.sobrantes)} MXN</strong><p>{importeConSigno(r.sobrantesUsd, "USD")} USD</p></div>
      </div>}
      <p className="mb-3 text-sm text-black/75">Totales del periodo y sucursal. No se compensan faltantes con sobrantes. Horario: {datos?.zona}.</p>
      {datos?.limitado && <p role="alert" className="mb-3 text-amber-900">Se muestran los 1,000 turnos más recientes. Los totales corresponden a esos turnos; reduce el periodo para consultar el resto.</p>}
      <div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm">Mostrar<select className={input} value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="diferencias">Con diferencias</option><option value="faltantes">Con faltantes</option><option value="sobrantes">Con sobrantes</option><option value="todos">Todos, incluyendo cajas cuadradas</option></select></label><label className="flex flex-col gap-1 text-sm">Buscar responsable o supervisor<input className={input} value={buscar} onChange={(e) => setBuscar(e.target.value)} /></label></div>
      <p role="status" className="mb-3 text-sm">{filas.length} turnos en la lista</p>
      {!filas.length ? <p className="py-3 text-sm">No hay arqueos guardados que coincidan con estos filtros.</p> : <ul className="divide-y divide-black/20">{filas.map((f) => <li key={f.id} className="py-4">
        <div className="flex flex-wrap justify-between gap-2"><strong>{f.sucursal} · {f.cajero}</strong><span className="text-sm">{formatFechaHora(f.fecha, datos?.zona)}</span></div>
        <p className="mt-1 text-sm">Responsable de apertura: {f.cajero}. Arqueo autorizado por: {f.supervisor}.</p>
        <div className="my-2 grid gap-2 sm:grid-cols-2"><p>Pesos: <strong>{importeConSigno(f.diferencia)} MXN</strong><span className="block text-sm text-black/75">Esperado ${f.esperado.toFixed(2)} · Contado ${f.contado.toFixed(2)}</span></p><p>Dólares: <strong>{importeConSigno(f.diferenciaUsd, "USD")} USD</strong><span className="block text-sm text-black/75">Esperado ${f.esperadoUsd.toFixed(2)} · Contado ${f.contadoUsd.toFixed(2)}</span></p></div>
        <p className="text-sm">{f.corte ? `Corte final: ${importeConSigno(f.corte.diferencia)} MXN / ${importeConSigno(f.corte.diferenciaUsd, "USD")} USD. ${formatFechaHora(f.corte.fecha, datos?.zona)}` : "Caja abierta: el corte final todavía no se ha registrado."}</p>
        {f.notas && <p className="mt-1 whitespace-pre-wrap text-sm text-black/75">Nota: {f.notas}</p>}
        <p className="mt-1 text-xs text-black/70">Turno {f.cajaId}</p>
      </li>)}</ul>}
      <p className="mt-4 text-sm text-black/75">El arqueo es un conteo intermedio. El corte conserva su diferencia final; no se suman ambas diferencias ni se modifican las ventas.</p>
    </>}
  </Card>;
}
