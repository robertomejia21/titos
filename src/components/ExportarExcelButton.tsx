"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui";
import type { ReporteExcel } from "@/lib/exportarExcel";

export function ExportarExcelButton({ crearReporte, disabled = false }: {
  crearReporte: () => ReporteExcel;
  disabled?: boolean;
}) {
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState("");
  const enCurso = useRef(false);
  async function exportar() {
    if (disabled || enCurso.current) return;
    enCurso.current = true;
    setExportando(true);
    setError("");
    try {
      const reporte = crearReporte();
      const { descargarExcel } = await import("@/lib/exportarExcel");
      descargarExcel(reporte);
    } catch {
      setError("No se pudo descargar el Excel. Intenta de nuevo.");
    } finally {
      enCurso.current = false;
      setExportando(false);
    }
  }
  return <div>
    <Button type="button" variant="ghost" onClick={exportar} disabled={disabled || exportando}
      aria-busy={exportando} className="inline-flex min-h-11 items-center gap-2 border border-titos-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titos-green-800">
      <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
      {exportando ? "Preparando Excel..." : "Exportar Excel"}
    </Button>
    {error && <p role="alert" className="mt-1 text-sm text-red-800">{error}</p>}
  </div>;
}
