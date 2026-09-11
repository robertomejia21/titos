import { tienePermiso } from "@/lib/permisos";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, notFound } from "@/lib/apiAuth";
import { consultarHistorialVentas, filtroDesdeUrl } from "@/lib/historialVentas";
import { generarTablaPDF, formatMoney } from "@/lib/pdf";
import { formatFechaHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  efectivo_usd: "Efvo. USD",
  tarjeta: "Tarjeta",
  transferencia: "Transf.",
  vales: "Vales",
  credito: "Credito",
};

function truncar(texto: string, max: number) {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if ((session.role !== "matriz" && !tienePermiso(session, "reportes.globales"))) return forbidden();

  const url = new URL(req.url);
  const filtro = filtroDesdeUrl(url);

  await connectDB();
  const { filas, resumen } = await consultarHistorialVentas(filtro);

  if (filas.length === 0) return notFound("No hay ventas en el periodo seleccionado");

  const periodo = `${filtro.desde || "inicio"} a ${filtro.hasta || "hoy"}`;
  const sucursalTexto = filtro.sucursalId ? filas[0]?.sucursalNombre ?? "Sucursal" : "Todas las sucursales";

  const pdfBytes = await generarTablaPDF({
    titulo: "Historial de ventas",
    subtitulo: [
      `Periodo: ${periodo} · ${sucursalTexto}`,
      `${resumen.cantidad} ventas · ticket promedio ${formatMoney(resumen.ticketPromedio)}`,
    ],
    tabla: {
      titulo: "Detalle de ventas",
      columnas: [
        { header: "Folio", width: 92 },
        { header: "Fecha", width: 96 },
        { header: "Sucursal", width: 104 },
        { header: "Cliente", width: 104 },
        { header: "Pago", width: 66 },
        { header: "Total", width: 62, align: "right" },
      ],
      filas: filas.map((v) => [
        truncar(v.folio, 20),
        formatFechaHora(v.fecha, ZONA_HORARIA_DEFAULT, "—"),
        truncar(v.sucursalNombre, 22),
        truncar(v.clienteNombre || "Público en general", 22),
        truncar((v.pagos ?? []).map((p) => ETIQUETA_METODO[p.metodoPago] ?? p.metodoPago).join("+"), 14),
        formatMoney(v.total),
      ]),
    },
    tablaExtra: {
      titulo: "Resumen por sucursal",
      columnas: [
        { header: "Sucursal", width: 260 },
        { header: "Ventas", width: 100, align: "right" },
        { header: "Total", width: 164, align: "right" },
      ],
      filas: resumen.porSucursal.map((s) => [truncar(s.nombre, 52), String(s.cantidad), formatMoney(s.total)]),
    },
    totalLabel: "Total vendido:",
    totalValor: formatMoney(resumen.total),
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="historial-ventas-${filtro.desde || "inicio"}-a-${filtro.hasta || "hoy"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
