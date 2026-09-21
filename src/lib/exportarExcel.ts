import * as XLSX from "xlsx";

export type CeldaExcel = string | number | boolean | null | undefined;
export type HojaExcel = {
  nombre: string;
  columnas: string[];
  filas: CeldaExcel[][];
  importes?: number[];
};
export type ReporteExcel = {
  nombre: string;
  filtros: [string, CeldaExcel][];
  hojas: HojaExcel[];
};

export function crearLibroExcel(reporte: ReporteExcel) {
  const libro = XLSX.utils.book_new();
  const hojas: HojaExcel[] = [
    { nombre: "Filtros", columnas: ["Dato", "Valor"], filas: reporte.filtros },
    ...reporte.hojas,
  ];
  for (const hoja of hojas) {
    const tabla = XLSX.utils.aoa_to_sheet([hoja.columnas, ...hoja.filas]);
    tabla["!cols"] = hoja.columnas.map((columna, indice) => ({
      wch: Math.min(55, Math.max(16, columna.length + 2, ...hoja.filas.slice(0, 100).map((fila) => String(fila[indice] ?? "").length + 2))),
    }));
    if (hoja.filas.length) tabla["!autofilter"] = { ref: tabla["!ref"]! };
    for (let fila = 1; fila <= hoja.filas.length; fila++) {
      for (const columna of hoja.importes ?? []) {
        const celda = tabla[XLSX.utils.encode_cell({ r: fila, c: columna })];
        if (celda?.t === "n") celda.z = '#,##0.00;[Red]-#,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(libro, tabla, hoja.nombre);
  }
  return libro;
}

export function descargarExcel(reporte: ReporteExcel) {
  XLSX.writeFile(crearLibroExcel(reporte), `${reporte.nombre}.xlsx`, { compression: true });
}
