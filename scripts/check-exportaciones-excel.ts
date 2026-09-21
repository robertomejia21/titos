import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import * as XLSX from "xlsx";
import { crearLibroExcel } from "../src/lib/exportarExcel";
import { excelVentas, excelCortes, excelFacturas, excelPorFacturar, excelArqueos, excelGlobal } from "../src/lib/exportacionesFinancieras";
import { resumirVentas } from "../src/lib/historialVentas";
import type { Corte } from "../src/components/matriz/CortesManager";
import type { Factura } from "../src/components/matriz/FacturasManager";
import type { ResumenGlobal } from "../src/lib/facturaGlobalTipos";

const fecha = "2026-09-21T02:30:00Z";
const zona = "America/Tijuana";
const filtros: [string, string][] = [["Desde", "2026-09-20"], ["Hasta", "2026-09-20"], ["Sucursal", "Tienda de prueba"]];
const ventas = Array.from({ length: 31 }, (_, i) => ({
  _id: String(i), folio: `000${i}`, fecha, corte: "2026-09-20", sucursalId: "tienda", sucursalNombre: "Tienda de prueba",
  clienteNombre: i === 0 ? '=HYPERLINK("https://example.invalid")' : "Cliente de prueba", total: i === 30 ? 999 : 10.25,
  pagos: [{ metodoPago: "tarjeta", monto: i === 30 ? 999 : 10.25, tarjetaTipo: "debito" }],
  estado: i === 30 ? "cancelada" : "completada", esVentas2: i === 1, articulos: 1,
}));
const corte: Corte = {
  _id: "turno", sucursalId: { _id: "tienda", nombre: "Tienda de prueba", zonaHoraria: zona },
  fechaApertura: fecha, fechaCierre: fecha, efectivoInicial: 100, efectivoInicialUsd: 10,
  totalVentasEfectivo: 20, totalVentasTarjeta: 30, totalVentasTransferencia: 0,
  totalRetiros: 10, totalRetirosUsd: 2, efectivoEsperado: 110, efectivoContado: 105, diferencia: -5,
  efectivoEsperadoUsd: 8, efectivoContadoUsd: 9, diferenciaUsd: 1, notas: "Cierre de prueba",
  retiros: [{ _id: "r", folio: "RET-1", monto: 2, moneda: "USD", motivo: "Prueba", usuarioNombre: "Operador de prueba", fecha }],
};
const factura: Factura = {
  _id: "f", folio: "FAC-001", serie: "A", ventaFolio: "0001", sucursalNombre: "Tienda de prueba",
  receptor: { razonSocial: "Cliente de prueba", rfc: "XAXX010101000", regimenFiscal: "616", usoCfdi: "S01", codigoPostal: "02100", direccionFiscal: "", emailFacturacion: "" },
  conceptos: [{ descripcion: "Producto de prueba", claveProdServ: "01010101", unidad: "pieza", cantidad: 1, valorUnitario: 10, importe: 10 }],
  tasaIva: 8, subtotal: 10, iva: 0.8, total: 10.8, formaPago: "01", metodoPago: "PUE", comentarios: [],
  estado: "generada", motivoCancelacion: "", timbrado: { estado: "pendiente", uuid: "", proveedor: "" }, creadoPorNombre: "Prueba", createdAt: fecha,
};
const arqueo = { id: "a", cajaId: "c", sucursalId: "tienda", sucursal: "Tienda de prueba", cajero: "Cajero de prueba", supervisor: "Supervisor de prueba", fecha, esperado: 110, contado: 105, diferencia: -5, esperadoUsd: 8, contadoUsd: 9, diferenciaUsd: 1, notas: "", corte: null };
const global: ResumenGlobal = {
  dia: "2026-09-20", hoy: "2026-09-21", sucursalId: "tienda", sucursalNombre: "Tienda de prueba", zonaHoraria: zona, huella: "prueba",
  ventas: 1, totalVentas: 10.8, totalIndividuales: 0, totalGlobales: 10.8, totalPendiente: 0, diferencia: 0, credito: 0, devolucionesDia: 0, netoTrasDevoluciones: 10.8,
  pendientes: [], individuales: [], avisos: [], globales: [{ _id: "g", folio: "G-1", alcance: "todas", dia: "2026-09-20", sucursalNombre: "Todas", estado: "generada", total: 20.8, totalConsulta: 10.8, creadoPorNombre: "Prueba", createdAt: fecha, motivoCancelacion: "",
    ventas: [{ ventaId: "v1", sucursalId: "tienda", sucursalNombre: "Tienda de prueba", folio: "V1", fecha, total: 10.8, esVentas2: false, credito: 0 }, { ventaId: "v2", sucursalId: "otra", sucursalNombre: "Otra tienda", folio: "V2", fecha, total: 10, esVentas2: false, credito: 0 }],
  }],
};

async function main() {
  const reportes = [excelVentas(ventas, resumirVentas(ventas), zona, filtros), excelCortes([corte], filtros),
    excelFacturas([factura, { ...factura, _id: "cancelada", folio: "FAC-C", estado: "cancelada", total: 999 }], zona, filtros),
    excelPorFacturar(ventas.map(v => ({ ...v, clienteId: null })), zona, filtros), excelArqueos([arqueo], zona, filtros), excelGlobal(global)];
  await mkdir("outputs/excel-pruebas", { recursive: true });
  const libros = reportes.map(reporte => {
    const original = crearLibroExcel(reporte);
    const bytes = XLSX.write(original, { type: "buffer", bookType: "xlsx" });
    assert.equal(bytes.subarray(0, 2).toString(), "PK", "Es un XLSX real, no CSV renombrado");
    const libro = XLSX.read(bytes, { type: "buffer", cellNF: true });
    assert.equal(libro.SheetNames.length, reporte.hojas.length + 1);
    for (const hoja of reporte.hojas) {
      const sheet = libro.Sheets[hoja.nombre];
      assert.equal(XLSX.utils.decode_range(sheet["!ref"]!).e.r, hoja.filas.length);
      for (const [celda, valor] of Object.entries(sheet)) {
        if (!celda.startsWith("!")) assert.equal(valor.f, undefined, "Los datos de clientes no se ejecutan como fórmulas");
      }
    }
    XLSX.writeFile(original, `outputs/excel-pruebas/${reporte.nombre}.xlsx`);
    return libro;
  });
  assert.equal(libros[0].Sheets.Ventas.A2.v, "0000", "Conserva ceros iniciales");
  assert.equal(libros[0].Sheets.Ventas.A2.t, "s");
  assert.equal(libros[0].Sheets.Ventas.I2.v, 10.25);
  assert.equal(libros[0].Sheets.Ventas.I2.t, "n");
  assert.match(libros[0].Sheets.Ventas.B2.v, /20\/09\/26/, "Fecha en zona Tijuana");
  assert.equal(libros[0].Sheets.Ventas.E2.v, ventas[0].clienteNombre);
  assert.equal(libros[0].Sheets.Resumen.B3.v, 307.5, "Excluye los 999 de la cancelación");
  assert.equal(libros[0].Sheets.Resumen.B6.v, 999);
  assert.equal(libros[0].Sheets.Ventas.A32.v, "00030", "Incluye la segunda página");
  assert.equal(libros[1].Sheets.Cortes.S2.v, -5, "Diferencia en pesos");
  assert.equal(libros[1].Sheets.Cortes.AA2.v, 1, "Diferencia en dólares separada");
  assert.equal(libros[1].Sheets.Retiros.F2.v, "USD");
  assert.equal(libros[2].Sheets.Resumen.B3.v, 10.8, "Factura cancelada no aumenta el total vigente");
  assert.equal(libros[2].Sheets.Facturas.L2.v, "01", "Código SAT conserva cero inicial");
  assert.equal(libros[4].Sheets.Arqueos.M2, undefined, "Caja abierta no inventa diferencia final cero");
  assert.equal(libros[5].Sheets["Ventas en globales"].C2.v, "V1");
  assert.equal(XLSX.utils.decode_range(libros[5].Sheets["Ventas en globales"]["!ref"]!).e.r, 1, "Respeta filtro de sucursal en la global");
  const vacio = crearLibroExcel(excelFacturas([], zona, filtros));
  assert.equal(vacio.Sheets.Facturas.A1.v, "Folio", "Libro vacío conserva encabezados");
  console.log("OK: 6 libros XLSX, detalle de todas las páginas, importes numéricos, centavos, cancelaciones excluidas, MXN/USD separados, fecha local, filtros, folios/SAT como texto y contenido sin fórmulas ejecutables.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
