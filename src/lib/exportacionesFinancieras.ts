import type { ReporteExcel, HojaExcel } from "./exportarExcel";
import type { VentaHistorial, Resumen } from "@/components/matriz/HistorialVentasManager";
import type { Corte } from "@/components/matriz/CortesManager";
import type { Factura, VentaFacturable } from "@/components/matriz/FacturasManager";
import type { ResumenGlobal } from "./facturaGlobalTipos";
import { formatFechaHora, ZONA_HORARIA_DEFAULT } from "./zonasHorarias";
import { resumenArqueos, type FilaArqueo } from "./reporteArqueos";

type Filtros = ReporteExcel["filtros"];
const suma = (valores: number[]) => valores.reduce((total, n) => total + Math.round(n * 100), 0) / 100;
const resumen = (filas: HojaExcel["filas"]): HojaExcel => ({ nombre: "Resumen", columnas: ["Concepto", "Valor"], filas, importes: [1] });

export function excelVentas(ventas: VentaHistorial[], datos: Resumen, zona: string, filtros: Filtros): ReporteExcel {
  return { nombre: "titos-historial-ventas", filtros: [...filtros, ["Horario", zona], ["Moneda de importes", "MXN; los pagos en dólares se expresan en su equivalente registrado en MXN"]], hojas: [
    resumen([["Ventas vigentes", datos.cantidad], ["Total vendido MXN", datos.total], ["Ticket promedio MXN", datos.ticketPromedio], ["Ventas canceladas", datos.canceladas], ["Total cancelado MXN (excluido)", datos.totalCancelado]]),
    { nombre: "Ventas", columnas: ["Folio", "Fecha y hora", "Día de corte", "Sucursal", "Cliente", "Artículos", "Tipo", "Estado", "Total MXN"],
      filas: ventas.map(v => [v.folio, formatFechaHora(v.fecha, zona), v.corte, v.sucursalNombre, v.clienteNombre || "Público en general", v.articulos, v.esVentas2 ? "Nota de venta" : "Ticket", v.estado, v.total]), importes: [8] },
    { nombre: "Pagos", columnas: ["Folio", "Sucursal", "Estado de venta", "Método de pago", "Tipo de tarjeta", "Monto equivalente MXN"],
      filas: ventas.flatMap(v => v.pagos.map(p => [v.folio, v.sucursalNombre, v.estado, p.metodoPago, p.tarjetaTipo || "", p.monto])), importes: [5] },
    { nombre: "Por sucursal", columnas: ["Sucursal", "Ventas vigentes", "Total MXN"], filas: datos.porSucursal.map(s => [s.nombre, s.cantidad, s.total]), importes: [2] },
    { nombre: "Por día", columnas: ["Día de corte", "Ventas vigentes", "Total MXN"], filas: datos.porDia.map(d => [d.corte, d.cantidad, d.total]), importes: [2] },
    { nombre: "Por forma de pago", columnas: ["Método", "Total vigente MXN"], filas: Object.entries(datos.porMetodo), importes: [1] },
    { nombre: "Por tipo de tarjeta", columnas: ["Tipo de tarjeta", "Total vigente MXN"], filas: datos.porTipoTarjeta.map(t => [t.etiqueta, t.monto]), importes: [1] },
  ] };
}

export function excelCortes(cortes: Corte[], filtros: Filtros): ReporteExcel {
  const sucursal = (c: Corte) => typeof c.sucursalId === "string" ? "Sucursal" : c.sucursalId.nombre;
  const zona = (c: Corte) => typeof c.sucursalId === "string" ? ZONA_HORARIA_DEFAULT : c.sucursalId.zonaHoraria || ZONA_HORARIA_DEFAULT;
  return { nombre: "titos-cortes-caja", filtros: [...filtros, ["Horario", "Cada corte usa la zona horaria de su sucursal"], ["Monedas", "MXN y USD separados; no se suman entre sí"]], hojas: [
    resumen([["Cortes cerrados", cortes.length], ["Ventas efectivo MXN", suma(cortes.map(c => c.totalVentasEfectivo))],
      ["Ventas tarjeta MXN", suma(cortes.map(c => c.totalVentasTarjeta))], ["Ventas transferencia MXN", suma(cortes.map(c => c.totalVentasTransferencia))],
      ["Ventas vales MXN", suma(cortes.map(c => c.totalVentasVales ?? 0))], ["Ventas crédito MXN", suma(cortes.map(c => c.totalVentasCredito ?? 0))],
      ["Dólares cobrados USD", suma(cortes.map(c => c.totalVentasDolaresUsd ?? 0))], ["Retiros MXN", suma(cortes.map(c => c.totalRetiros))],
      ["Retiros USD", suma(cortes.map(c => c.totalRetirosUsd ?? 0))], ["Diferencia MXN", suma(cortes.map(c => c.diferencia))], ["Diferencia USD", suma(cortes.map(c => c.diferenciaUsd ?? 0))]]),
    { nombre: "Cortes", columnas: ["Turno", "Sucursal", "Apertura", "Cierre", "Horario", "Abrió", "Cerró", "Fondo MXN", "Ventas efectivo MXN", "Ventas tarjeta MXN", "Transferencia MXN", "Vales MXN", "Crédito MXN", "Abonos efectivo MXN", "Devoluciones MXN", "Retiros MXN", "Esperado MXN", "Contado MXN", "Diferencia MXN", "Fondo USD", "Ventas USD", "Equivalente ventas USD en MXN", "Cambio dólares en MXN", "Retiros USD", "Esperado USD", "Contado USD", "Diferencia USD", "Notas"],
      filas: cortes.map(c => [c._id, sucursal(c), formatFechaHora(c.fechaApertura, zona(c)), formatFechaHora(c.fechaCierre, zona(c)), zona(c), c.usuarioAperturaId?.nombre || "", c.usuarioCierreId?.nombre || "", c.efectivoInicial, c.totalVentasEfectivo, c.totalVentasTarjeta, c.totalVentasTransferencia, c.totalVentasVales ?? 0, c.totalVentasCredito ?? 0, c.totalAbonosEfectivo ?? 0, c.totalDevoluciones ?? 0, c.totalRetiros, c.efectivoEsperado, c.efectivoContado, c.diferencia, c.efectivoInicialUsd ?? 0, c.totalVentasDolaresUsd ?? 0, c.totalVentasDolaresMxn ?? 0, c.totalCambioDolaresMxn ?? 0, c.totalRetirosUsd ?? 0, c.efectivoEsperadoUsd ?? 0, c.efectivoContadoUsd ?? 0, c.diferenciaUsd ?? 0, c.notas]), importes: Array.from({ length: 20 }, (_, i) => i + 7) },
    { nombre: "Retiros", columnas: ["Turno", "Sucursal", "Folio", "Fecha y hora", "Responsable", "Moneda", "Monto", "Motivo"],
      filas: cortes.flatMap(c => c.retiros.map(r => [c._id, sucursal(c), r.folio, formatFechaHora(r.fecha, zona(c)), r.usuarioNombre, r.moneda, r.monto, r.motivo])), importes: [6] },
    { nombre: "Tarjetas por terminal", columnas: ["Turno", "Sucursal", "Terminal", "Monto MXN"], filas: cortes.flatMap(c => (c.tarjetaPorTerminal ?? []).map(t => [c._id, sucursal(c), t.alias, t.monto])), importes: [3] },
    { nombre: "Tarjetas por tipo", columnas: ["Turno", "Sucursal", "Tipo", "Monto MXN"], filas: cortes.flatMap(c => (c.tarjetaPorTipo ?? []).map(t => [c._id, sucursal(c), t.etiqueta, t.monto])), importes: [3] },
  ] };
}

export function excelFacturas(facturas: Factura[], zona: string, filtros: Filtros): ReporteExcel {
  return { nombre: "titos-facturas-emitidas", filtros: [...filtros, ["Horario", zona]], hojas: [
    resumen([["Facturas vigentes", facturas.filter(f => f.estado === "generada").length], ["Total vigente MXN", suma(facturas.filter(f => f.estado === "generada").map(f => f.total))], ["Canceladas", facturas.filter(f => f.estado === "cancelada").length], ["Total cancelado MXN (excluido)", suma(facturas.filter(f => f.estado === "cancelada").map(f => f.total))]]),
    { nombre: "Facturas", columnas: ["Folio", "Serie", "Venta", "Fecha y hora", "Sucursal", "Razón social", "RFC", "Estado", "Subtotal MXN", "IVA MXN", "Total MXN", "Forma pago SAT", "Método pago SAT", "Timbrado", "UUID", "Creó", "Motivo cancelación"],
      filas: facturas.map(f => [f.folio, f.serie, f.ventaFolio, formatFechaHora(f.createdAt, zona), f.sucursalNombre, f.receptor.razonSocial, f.receptor.rfc, f.estado, f.subtotal, f.iva, f.total, f.formaPago, f.metodoPago, f.timbrado?.estado || "pendiente", f.timbrado?.uuid || "", f.creadoPorNombre, f.motivoCancelacion]), importes: [8, 9, 10] },
    { nombre: "Conceptos", columnas: ["Factura", "Estado", "Descripción", "Clave SAT", "Unidad", "Cantidad", "Valor unitario MXN", "Importe MXN"],
      filas: facturas.flatMap(f => f.conceptos.map(c => [f.folio, f.estado, c.descripcion, c.claveProdServ, c.unidad, c.cantidad, c.valorUnitario, c.importe])), importes: [6, 7] },
  ] };
}

export function excelPorFacturar(ventas: VentaFacturable[], zona: string, filtros: Filtros): ReporteExcel {
  return { nombre: "titos-ventas-por-facturar", filtros: [...filtros, ["Horario", zona]], hojas: [
    resumen([["Ventas por facturar consultadas", ventas.length], ["Total MXN", suma(ventas.map(v => v.total))]]),
    { nombre: "Ventas por facturar", columnas: ["Folio", "Fecha y hora", "Sucursal", "Cliente", "Artículos", "Tipo", "Total MXN"], filas: ventas.map(v => [v.folio, formatFechaHora(v.fecha, zona), v.sucursalNombre, v.clienteNombre || "Público en general", v.articulos, v.esVentas2 ? "Nota de venta" : "Ticket", v.total]), importes: [6] },
  ] };
}

export function excelArqueos(filas: FilaArqueo[], zona: string, filtros: Filtros): ReporteExcel {
  const r = resumenArqueos(filas);
  return { nombre: "titos-arqueos", filtros: [...filtros, ["Horario", zona], ["Criterio", "Último arqueo del turno. No se suma la diferencia del arqueo con la del corte final."]], hojas: [
    resumen([["Turnos exportados", filas.length], ["Turnos con diferencias", r.cajasConDiferencia], ["Faltantes MXN", r.faltantes], ["Sobrantes MXN", r.sobrantes], ["Faltantes USD", r.faltantesUsd], ["Sobrantes USD", r.sobrantesUsd]]),
    { nombre: "Arqueos", columnas: ["Turno", "Sucursal", "Responsable", "Supervisor", "Fecha y hora", "Esperado MXN", "Contado MXN", "Diferencia MXN", "Esperado USD", "Contado USD", "Diferencia USD", "Corte final", "Diferencia corte MXN", "Diferencia corte USD", "Notas"],
      filas: filas.map(f => [f.cajaId, f.sucursal, f.cajero, f.supervisor, formatFechaHora(f.fecha, zona), f.esperado, f.contado, f.diferencia, f.esperadoUsd, f.contadoUsd, f.diferenciaUsd, f.corte ? formatFechaHora(f.corte.fecha, zona) : "Pendiente", f.corte?.diferencia ?? null, f.corte?.diferenciaUsd ?? null, f.notas]), importes: [5, 6, 7, 8, 9, 10, 12, 13] },
  ] };
}

export function excelGlobal(datos: ResumenGlobal): ReporteExcel {
  return { nombre: `titos-global-${datos.dia}`, filtros: [["Día", datos.dia], ["Sucursal", datos.sucursalNombre], ["Horario", datos.zonaHoraria], ["Fiscal", "Conciliación interna. No es CFDI ni genera timbrado."], ["Avisos", datos.avisos.join("; ")]], hojas: [
    resumen([["Ventas del día MXN", datos.totalVentas], ["Facturas individuales MXN", datos.totalIndividuales], ["Globales vigentes MXN", datos.totalGlobales], ["Pendiente de incluir MXN", datos.totalPendiente], ["Diferencia MXN", datos.diferencia], ["Crédito MXN", datos.credito], ["Devoluciones del día MXN", datos.devolucionesDia], ["Neto tras devoluciones MXN", datos.netoTrasDevoluciones]]),
    { nombre: "Pendientes", columnas: ["Venta", "Sucursal", "Fecha y hora", "Tipo", "Total MXN", "Crédito MXN"], filas: datos.pendientes.map(v => [v.folio, v.sucursalNombre, formatFechaHora(v.fecha, datos.zonaHoraria), v.esVentas2 ? "Nota de venta" : "Ticket", v.total, v.credito]), importes: [4, 5] },
    { nombre: "Individuales", columnas: ["Factura", "Venta", "Total MXN", "Timbrada"], filas: datos.individuales.map(f => [f.folio, f.ventaFolio, f.total, f.timbrada ? "Sí" : "No"]), importes: [2] },
    { nombre: "Globales", columnas: ["Folio", "Día", "Sucursal", "Estado", "Total documento MXN", "Total en consulta MXN", "Creado por", "Fecha y hora", "Motivo cancelación"], filas: datos.globales.map(g => [g.folio, g.dia, g.sucursalNombre, g.estado, g.total, g.totalConsulta, g.creadoPorNombre, formatFechaHora(g.createdAt, datos.zonaHoraria), g.motivoCancelacion]), importes: [4, 5] },
    { nombre: "Ventas en globales", columnas: ["Global", "Estado global", "Venta", "Sucursal", "Fecha y hora", "Tipo", "Total MXN", "Crédito MXN"], filas: datos.globales.flatMap(g => g.ventas.filter(v => !datos.sucursalId || v.sucursalId === datos.sucursalId).map(v => [g.folio, g.estado, v.folio, v.sucursalNombre, formatFechaHora(v.fecha, datos.zonaHoraria), v.esVentas2 ? "Nota de venta" : "Ticket", v.total, v.credito])), importes: [6, 7] },
  ] };
}
