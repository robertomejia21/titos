import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  requireSession,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  puede,
} from "@/lib/apiAuth";
import FacturaGlobal from "@/models/FacturaGlobal";
import { generarTablaPDF, formatMoney } from "@/lib/pdf";
import type { VentaGlobal } from "@/lib/facturaGlobalTipos";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role !== "matriz" || !puede(usuario, "facturas.administrar"))
    return forbidden();
  const { id } = await params;
  if (!isValidObjectId(id)) return badRequest("Factura inválida.");
  await connectDB();
  const doc = await FacturaGlobal.findById(id).lean();
  if (!doc) return notFound();
  const pdf = await generarTablaPDF({
    titulo: "Factura global interna",
    subtitulo: [
      doc.folio,
      `Día de ventas: ${doc.dia} · ${doc.sucursalNombre}`,
      `Público en general · RFC ${doc.rfc} · Periodicidad diaria`,
      `Estado: ${doc.estado}. Sin timbre ni validez fiscal.`,
      "Importes del punto de venta en MXN. Desglose fiscal pendiente.",
      "Incluye notas de venta. No descuenta devoluciones ni agrega abonos.",
      "Las facturas individuales vigentes se excluyen de este documento.",
    ],
    tabla: {
      titulo: "Ventas incluidas",
      columnas: [
        { header: "Folio", width: 170 },
        { header: "Sucursal", width: 160 },
        { header: "Tipo", width: 65 },
        { header: "Importe MXN", width: 120, align: "right" },
      ],
      filas: (doc.ventas as VentaGlobal[]).map((v) => [
        v.folio,
        v.sucursalNombre.slice(0, 30),
        v.esVentas2 ? "Nota" : "Ticket",
        formatMoney(v.total),
      ]),
    },
    tablaExtra: {
      titulo: "Conciliación al generar",
      columnas: [
        { header: "Concepto", width: 365 },
        { header: "Importe MXN", width: 150, align: "right" },
      ],
      filas: [
        ["Ventas del día", formatMoney(doc.conciliacion?.totalVentas || 0)],
        [
          "Facturas individuales excluidas",
          formatMoney(doc.conciliacion?.individuales || 0),
        ],
        [
          "Otras globales vigentes",
          formatMoney(doc.conciliacion?.globalesAnteriores || 0),
        ],
      ],
    },
    totalLabel: "Total global:",
    totalValor: formatMoney(doc.total),
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="global-${doc.dia}-${doc.folio}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
