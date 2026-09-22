import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Factura from "@/models/Factura";
import { requireSession, unauthorized, forbidden, notFound } from "@/lib/apiAuth";
import { generarTablaPDF, formatMoney } from "@/lib/pdf";
import { REGIMENES_FISCALES, USOS_CFDI } from "@/lib/facturacion";
import { FORMAS_PAGO_SAT, METODOS_PAGO_SAT } from "@/lib/facturas";
import { formatFechaHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

function etiqueta(catalogo: readonly { value: string; label: string }[], value: string) {
  return catalogo.find((c) => c.value === value)?.label ?? value ?? "—";
}

function truncar(texto: string, max: number) {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  await connectDB();

  const factura = await Factura.findById(id).lean();
  if (!factura) return notFound("Factura no encontrada");

  const receptor = factura.receptor;
  const timbrado = factura.timbrado;
  const conceptos = (factura.conceptos ?? []) as {
    claveProdServ: string;
    descripcion: string;
    unidad: string;
    cantidad: number;
    valorUnitario: number;
    importe: number;
  }[];

  const pdfBytes = await generarTablaPDF({
    titulo: `Factura ${factura.serie}-${factura.folio}`,
    subtitulo: [
      `Receptor: ${receptor.razonSocial} · RFC ${receptor.rfc} · CP ${receptor.codigoPostal}`,
      `${etiqueta(REGIMENES_FISCALES, receptor.regimenFiscal)} · Uso CFDI ${etiqueta(USOS_CFDI, receptor.usoCfdi)}`,
      `Venta ${factura.ventaFolio} · ${factura.sucursalNombre} · ${formatFechaHora(
        factura.ventaFecha,
        ZONA_HORARIA_DEFAULT,
        "—"
      )}`,
      `${etiqueta(FORMAS_PAGO_SAT, factura.formaPago)} · ${etiqueta(METODOS_PAGO_SAT, factura.metodoPago)}`,
      factura.estado === "cancelada"
        ? `DOCUMENTO CANCELADO — ${factura.motivoCancelacion}`
        : timbrado?.estado === "timbrada"
          ? `CFDI timbrado · UUID ${timbrado.uuid}`
          : "Documento interno sin valor fiscal: pendiente de timbrado ante el SAT.",
    ],
    tabla: {
      titulo: "Conceptos",
      columnas: [
        { header: "Clave SAT", width: 60 },
        { header: "Descripción", width: 200 },
        { header: "Cant.", width: 44, align: "right" },
        { header: "Unidad", width: 46 },
        { header: "V. unitario", width: 68, align: "right" },
        { header: "Importe", width: 68, align: "right" },
      ],
      filas: conceptos.map((c) => [
        c.claveProdServ,
        truncar(c.descripcion, 44),
        String(c.cantidad),
        c.unidad,
        formatMoney(c.valorUnitario),
        formatMoney(c.importe),
      ]),
    },
    tablaExtra: {
      titulo: "Totales",
      columnas: [
        { header: "Concepto", width: 300 },
        { header: "Importe", width: 224, align: "right" },
      ],
      filas: [
        ["Subtotal", formatMoney(factura.subtotal)],
        [`IVA ${factura.tasaIva}%`, formatMoney(factura.iva)],
      ],
    },
    totalLabel: "Total:",
    totalValor: formatMoney(factura.total),
    // Solo las facturas timbradas llevan bloque fiscal. En las demás el PDF
    // sigue siendo lo que era: un documento interno.
    selloFiscal:
      timbrado?.estado === "timbrada" || timbrado?.estado === "cancelada_sat"
        ? {
            qrBase64: timbrado.qrCode || undefined,
            datos: [
              { etiqueta: "Folio fiscal (UUID)", valor: timbrado.uuid || "—" },
              {
                etiqueta: "Fecha y hora de certificación",
                valor: formatFechaHora(timbrado.fechaTimbrado, ZONA_HORARIA_DEFAULT, "—"),
              },
              { etiqueta: "No. de certificado del SAT", valor: timbrado.noCertificadoSAT || "—" },
              { etiqueta: "RFC del proveedor de certificación", valor: timbrado.proveedor || "—" },
              ...(timbrado.estado === "cancelada_sat"
                ? [{
                    etiqueta: "Cancelada ante el SAT",
                    valor: `Motivo ${timbrado.motivoCancelacionSat}${timbrado.folioSustitucion ? ` · sustituye ${timbrado.folioSustitucion}` : ""}`,
                  }]
                : []),
            ],
            selloCFDI: timbrado.selloCFDI || undefined,
            selloSAT: timbrado.selloSAT || undefined,
            cadenaOriginal: timbrado.cadenaOriginalSAT || undefined,
          }
        : undefined,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="factura-${factura.serie}-${factura.folio}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
