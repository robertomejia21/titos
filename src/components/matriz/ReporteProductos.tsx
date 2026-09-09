"use client";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

type Totales = {importe: number; piezas: number; kg: number};
type Datos = {filas: {_id: {producto: string; sku: string; unidad: string}; nombre: string; cantidad: number; importe: number; sucursales: {id: string; cantidad: number; importe: number}[]}[]; total: number; porPagina: number; pagina: number; totales: Totales; porSucursal: (Totales & {_id: string})[]; sucursales: {id: string; nombre: string}[]};
const numero = (n: number) => n.toLocaleString("es-MX", {maximumFractionDigits: 3});
const dinero = (n: number) => n.toLocaleString("es-MX", {style: "currency", currency: "MXN"});
const campo = "mt-1 block w-full rounded-lg border border-black/20 bg-white p-2 text-sm focus-visible:outline-2 focus-visible:outline-titos-green-600";
function hoy() { return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date()); }
export function ReporteProductos() {
  const [filtros, setFiltros] = useState(() => ({desde: `${hoy().slice(0, 7)}-01`, hasta: hoy(), q: "", unidad: "pieza", notas: "excluir", medida: "cantidad", orden: "desc"}));
  const [consulta, setConsulta] = useState(() => new URLSearchParams({...filtros, pagina: "1"}).toString());
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function cargar() {
      setCargando(true); setError("");
      try {
        const res = await fetch(`/api/reportes/productos?${consulta}`, {signal: controller.signal});
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo consultar el reporte");
        setDatos(data);
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
      finally { if (!controller.signal.aborted) setCargando(false); }
    }
    void cargar();
    return () => controller.abort();
  }, [consulta]);
  const aplicado = new URLSearchParams(consulta);
  function pagina(valor: number) { const params = new URLSearchParams(consulta); params.set("pagina", String(valor)); setConsulta(params.toString()); }
  return <div className="space-y-4">
    <Card><form onSubmit={(e) => {e.preventDefault(); setConsulta(new URLSearchParams({...filtros, pagina: "1"}).toString());}} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">Desde<input required type="date" className={campo} value={filtros.desde} onChange={(e) => setFiltros({...filtros, desde: e.target.value})} /></label>
      <label className="text-sm">Hasta<input required type="date" min={filtros.desde} className={campo} value={filtros.hasta} onChange={(e) => setFiltros({...filtros, hasta: e.target.value})} /></label>
      <label className="text-sm sm:col-span-2">Producto o código (SKU)<input type="search" maxLength={120} className={campo} value={filtros.q} onChange={(e) => setFiltros({...filtros, q: e.target.value})} placeholder="Ej. leche o 750..." /></label>
      <label className="text-sm">Unidad<select className={campo} value={filtros.unidad} onChange={(e) => setFiltros({...filtros, unidad: e.target.value, medida: e.target.value === "todas" ? "importe" : filtros.medida})}><option value="pieza">Piezas</option><option value="kg">Kilos</option><option value="todas">Ambas (por importe)</option></select></label>
      <label className="text-sm">Tipo de venta<select className={campo} value={filtros.notas} onChange={(e) => setFiltros({...filtros, notas: e.target.value})}><option value="excluir">Ventas, sin notas</option><option value="incluir">Ventas y notas</option><option value="solo">Solo notas</option></select></label>
      <label className="text-sm">Comparar por<select className={campo} value={filtros.medida} onChange={(e) => setFiltros({...filtros, medida: e.target.value})}><option value="cantidad" disabled={filtros.unidad === "todas"}>Cantidad</option><option value="importe">Importe en pesos</option></select></label>
      <label className="text-sm">Orden<select className={campo} value={filtros.orden} onChange={(e) => setFiltros({...filtros, orden: e.target.value})}><option value="desc">De mayor a menor</option><option value="asc">De menor a mayor</option></select></label>
      <Button type="submit" disabled={cargando}>Aplicar filtros</Button>
    </form></Card>
    <p className="text-sm text-black/70">Se cuentan ventas completadas por día de corte local. Se excluyen cancelaciones; las devoluciones se consultan por separado. Los productos sin ventas en el periodo no aparecen. Cada código y presentación se compara por separado.</p>
    {cargando ? <p role="status">Consultando ventas…</p> : error ? <p role="alert" className="text-red-700">{error}</p> : datos ? <>
      <p className="text-sm text-black/70">Resultados del {aplicado.get("desde")} al {aplicado.get("hasta")} · {aplicado.get("notas") === "excluir" ? "Sin notas" : aplicado.get("notas") === "solo" ? "Solo notas" : "Incluye notas"}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="text-sm text-black/60">Importe de productos</p><p className="text-xl font-semibold">{dinero(datos.totales.importe)}</p></Card>
        <Card><p className="text-sm text-black/60">Piezas vendidas</p><p className="text-xl font-semibold">{numero(datos.totales.piezas)}</p></Card>
        <Card><p className="text-sm text-black/60">Kilos vendidos</p><p className="text-xl font-semibold">{numero(datos.totales.kg)}</p></Card>
      </div>
      {datos.total === 0 ? <Card>No hay ventas de productos con estos filtros.</Card> : <>
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white" tabIndex={0} role="region" aria-label="Comparación de ventas por sucursal">
          <table className="w-full text-left text-sm">
            <caption className="p-3 text-left">{datos.total} productos · Cada celda muestra cantidad e importe.</caption>
            <thead><tr className="border-b border-black/10"><th scope="col" className="p-3">Producto / SKU</th><th scope="col" className="p-3">Unidad</th>{datos.sucursales.map((s) => <th key={s.id} scope="col" className="min-w-36 p-3">{s.nombre}</th>)}<th scope="col" className="min-w-36 p-3">Total</th></tr></thead>
            <tbody>{datos.filas.map((fila) => <tr key={`${fila._id.producto}:${fila._id.sku}:${fila._id.unidad}`} className="border-b border-black/5">
              <th scope="row" className="min-w-48 p-3 font-medium">{fila.nombre}<span className="block text-xs text-black/60">{fila._id.sku}</span></th><td className="p-3">{fila._id.unidad}</td>
              {datos.sucursales.map((s) => {const celda = fila.sucursales.find((c) => c.id === s.id); return <td key={s.id} className="p-3 tabular-nums">{numero(celda?.cantidad ?? 0)}<span className="block text-xs text-black/60">{dinero(celda?.importe ?? 0)}</span></td>;})}
              <td className="p-3 font-semibold tabular-nums">{numero(fila.cantidad)}<span className="block text-xs">{dinero(fila.importe)}</span></td>
            </tr>)}</tbody>
            <tfoot><tr className="bg-titos-green-100"><th colSpan={2} className="p-3">Total del periodo filtrado</th>{datos.sucursales.map((s) => {const t = datos.porSucursal.find((x) => x._id === s.id); return <td key={s.id} className="p-3 text-xs">{numero(t?.piezas ?? 0)} pzas · {numero(t?.kg ?? 0)} kg<strong className="block">{dinero(t?.importe ?? 0)}</strong></td>;})}<td className="p-3 font-semibold">{dinero(datos.totales.importe)}</td></tr></tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" disabled={datos.pagina <= 1} onClick={() => pagina(datos.pagina - 1)}>Anterior</Button><span className="text-sm">Página {datos.pagina} de {Math.ceil(datos.total / datos.porPagina)}</span><Button variant="ghost" disabled={datos.pagina * datos.porPagina >= datos.total} onClick={() => pagina(datos.pagina + 1)}>Siguiente</Button></div>
      </>}
    </> : null}
  </div>;
}
