export type VentaCorteDiario = { folio: string; total: number; descuento?: number; esVentas2?: boolean; pagos: { metodoPago: string; monto: number; montoUsd?: number; terminalAlias?: string }[] };
export type GrupoCorteDiario = {
  nombre: string; zona: string; ventas: VentaCorteDiario[];
  cierres: { responsable: string; fecha: string; fondo: number; fondoUsd: number; esperado: number; contado: number; diferencia: number; esperadoUsd: number; contadoUsd: number; diferenciaUsd: number }[];
  retiros: { folio: string; fecha: string; monto: number; moneda: string; motivo: string }[];
  abonos: { monto: number; metodoPago: string }[];
  devoluciones: { folio: string; montoEfectivo: number; montoCredito: number; total: number }[];
};
export const escaparCorte = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const sumar = (a: number[]) => a.reduce((s, n) => s + Math.round((n || 0) * 100), 0) / 100;
const dinero = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
const tabla = (headers: string[], filas: (string | number)[][]) => `<table><thead><tr>${headers.map(h => `<th>${escaparCorte(h)}</th>`).join("")}</tr></thead><tbody>${filas.length ? filas.map(f => `<tr>${f.map(v => `<td>${escaparCorte(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sin movimientos registrados</td></tr>`}</tbody></table>`;

export function resumenVentasDiario(ventas: VentaCorteDiario[]) {
  const pagos = ventas.flatMap(v => v.pagos);
  const metodos = [...new Set(pagos.map(p => p.metodoPago))].sort().map(metodo => ({ metodo, monto: sumar(pagos.filter(p => p.metodoPago === metodo).map(p => p.monto)) }));
  return { cantidad: ventas.length, total: sumar(ventas.map(v => v.total)), descuento: sumar(ventas.map(v => v.descuento ?? 0)), metodos, dolares: sumar(pagos.map(p => p.montoUsd ?? 0)) };
}

export function corteDiarioHtml(dia: string, incluirNotas: boolean, grupos: GrupoCorteDiario[]) {
  const e = escaparCorte;
  const modo = incluirNotas ? "Con notas de venta" : "Sin notas de venta";
  const total = resumenVentasDiario(grupos.flatMap(g => g.ventas));
  const ventasTabla = (ventas: VentaCorteDiario[]) => {
    const r = resumenVentasDiario(ventas);
    return tabla(["Operaciones", "Folio inicial", "Folio final", "Descuentos", "Total registrado"], [[r.cantidad, ventas[0]?.folio ?? "-", ventas.at(-1)?.folio ?? "-", dinero(r.descuento), dinero(r.total)]]);
  };
  const secciones = grupos.map(g => {
    const r = resumenVentasDiario(g.ventas);
    return `<section><h2>${e(g.nombre)}</h2><p>Fecha: ${e(dia)} · Horario local: ${e(g.zona)}</p>
      <h3>Apertura / cierre</h3><p>Cajas cerradas durante el día. El fondo y las diferencias conservan todas las operaciones de cada turno, incluso al excluir notas del resumen de ventas.</p>
      ${tabla(["Responsable de apertura", "Cierre", "Fondo MXN", "Esperado MXN", "Contado MXN", "Diferencia MXN"], g.cierres.map(c => [c.responsable,c.fecha,dinero(c.fondo),dinero(c.esperado),dinero(c.contado),dinero(c.diferencia)]))}
      ${tabla(["Cierre", "Fondo USD", "Esperado USD", "Contado USD", "Diferencia USD"], g.cierres.map(c => [c.fecha,dinero(c.fondoUsd),dinero(c.esperadoUsd),dinero(c.contadoUsd),dinero(c.diferenciaUsd)]))}
      <h3>Retiro de efectivo del día</h3>${tabla(["Folio", "Fecha", "Moneda", "Monto", "Motivo"],g.retiros.map(x=>[x.folio,x.fecha,x.moneda,dinero(x.monto),x.motivo]))}
      <p><b>Retiros MXN: ${dinero(sumar(g.retiros.filter(x=>x.moneda!=="USD").map(x=>x.monto)))} · Retiros USD: ${dinero(sumar(g.retiros.filter(x=>x.moneda==="USD").map(x=>x.monto)))}</b></p>
      <h3>Ventas del día, sin notas</h3>${ventasTabla(g.ventas.filter(v=>!v.esVentas2))}
      ${incluirNotas ? `<h3>Notas de venta del día</h3>${ventasTabla(g.ventas.filter(v=>v.esVentas2))}` : ""}
      <h3>Resumen por forma de pago</h3>${tabla(["Método", "Importe equivalente MXN"],r.metodos.map(p=>[p.metodo,dinero(p.monto)]))}
      <p>Dólares recibidos en estas ventas: ${dinero(r.dolares)} USD. Su equivalente en pesos ya está incluido en el resumen.</p>
      <h3>Devoluciones pagadas del día</h3>${tabla(["Folio", "Efectivo MXN", "Ajuste a crédito MXN", "Total MXN"],g.devoluciones.map(d=>[d.folio,dinero(d.montoEfectivo),dinero(d.montoCredito),dinero(d.total)]))}
      <h3>Abonos a cuentas del día</h3>${tabla(["Forma de pago", "Importe MXN"],g.abonos.map(a=>[a.metodoPago,dinero(a.monto)]))}
      <p class="total">Ventas registradas: ${dinero(r.total)} MXN · ${r.cantidad} operaciones</p>
      <p>Los abonos y retiros se muestran completos y por separado; no son ventas nuevas. Las devoluciones corresponden al día de pago y pueden referirse a ventas de días anteriores. Se excluyen ventas canceladas.</p>
      </section>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corte Global ${e(dia)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172a1b;margin:24px auto;max-width:1050px;padding:0 16px}h1{font-size:25px}h2{font-size:20px;border-bottom:2px solid #264f31;padding-bottom:8px}h3{font-size:14px;margin:22px 0 8px}p{line-height:1.5}.aviso{padding:12px;border:1px solid #977422;background:#fffbeb}.total{font-weight:bold;font-size:15px}table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px;table-layout:fixed}th,td{border:1px solid #aab4ad;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#edf3ee}tr{break-inside:avoid}thead{display:table-header-group}button{padding:10px 16px;background:#276738;color:white;border:0;border-radius:6px;cursor:pointer}section{margin-top:32px}@media print{body{margin:0;padding:0;max-width:none}.acciones{display:none}section{break-before:page}h2,h3{break-after:avoid}.aviso{background:white}}
    </style></head><body><div class="acciones"><button onclick="window.print()">Imprimir / Guardar PDF</button></div><h1>Mercados Titos · Corte Global diario</h1><p>${e(dia)} · ${e(modo)}</p><p class="aviso"><b>Reporte operativo. Desglose fiscal pendiente.</b> IVA, IEPS y bases gravables todavía no están integrados. Los importes son los registrados por el sistema; no se recalculan impuestos ni se sustituyen los cortes de caja.</p><p class="total">Total de ventas seleccionadas: ${dinero(total.total)} MXN · ${total.cantidad} operaciones</p>${secciones || "<p>No hay sucursales disponibles.</p>"}</body></html>`;
}
