// Descarga del XML timbrado. Es EL comprobante fiscal: el PDF es solo su
// representación impresa, y es este archivo el que el receptor necesita para
// deducir y el que hay que conservar cinco años.

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Factura from "@/models/Factura";
import { requireSession, unauthorized, forbidden, notFound, badRequest } from "@/lib/apiAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  await connectDB();

  const factura = await Factura.findById(id)
    .select("folio serie timbrado.xml timbrado.uuid")
    .lean<{ folio: string; serie: string; timbrado?: { xml?: string; uuid?: string } } | null>();
  if (!factura) return notFound("Factura no encontrada");
  if (!factura.timbrado?.xml) return badRequest("Esta factura no está timbrada: no tiene XML");

  const nombre = `${factura.serie || "A"}-${factura.folio}-${factura.timbrado.uuid || "cfdi"}.xml`;
  return new NextResponse(factura.timbrado.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
