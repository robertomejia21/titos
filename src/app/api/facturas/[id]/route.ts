import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Factura from "@/models/Factura";
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { ErrorCfdi } from "@/lib/cfdi";
import { MOTIVOS_CANCELACION, type MotivoCancelacion } from "@/lib/facturas";
import {
  ErrorTimbrado,
  cancelarFacturaEnSat,
  previsualizarCfdi,
  timbrarFactura,
} from "@/lib/timbrarFactura";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const { id } = await params;
  await connectDB();

  const factura = await Factura.findById(id).lean();
  if (!factura) return notFound("Factura no encontrada");

  return NextResponse.json(JSON.parse(JSON.stringify(factura)));
}

/**
 * Acciones sobre una factura ya generada:
 * - "comentar": agrega una nota al historial (aclaraciones, referencias, etc.).
 * - "revisarTimbrado": arma el CFDI sin enviarlo y reporta qué falta. No gasta
 *   timbre; existe para que nadie descubra los datos faltantes emitiendo.
 * - "timbrar": lo manda al PAC y guarda el XML, el UUID y los sellos.
 * - "cancelar": la marca como cancelada dejando el motivo. Si ya está timbrada,
 *   cancela primero ante el SAT con su motivo del catálogo (01 a 04).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  const accion = String(body?.accion ?? "");
  const { id } = await params;

  await connectDB();

  const factura = await Factura.findById(id);
  if (!factura) return notFound("Factura no encontrada");

  if (accion === "comentar") {
    const texto = String(body?.texto ?? "").trim();
    if (!texto) return badRequest("Escribe el comentario");
    if (texto.length > 2000) return badRequest("El comentario es demasiado largo");

    factura.comentarios.push({
      texto,
      usuarioId: session.userId,
      usuarioNombre: session.nombre,
      fecha: new Date(),
    });
    await factura.save();
    return NextResponse.json(JSON.parse(JSON.stringify(factura)));
  }

  if (accion === "revisarTimbrado") {
    // Arma el CFDI sin mandarlo: dice qué falta antes de gastar un timbre.
    try {
      await previsualizarCfdi(factura);
      return NextResponse.json({ listaParaTimbrar: true, problemas: [] });
    } catch (error) {
      if (error instanceof ErrorCfdi)
        return NextResponse.json({ listaParaTimbrar: false, problemas: error.problemas });
      throw error;
    }
  }

  if (accion === "timbrar") {
    try {
      const timbrada = await timbrarFactura(factura);
      return NextResponse.json(JSON.parse(JSON.stringify(timbrada)));
    } catch (error) {
      if (error instanceof ErrorTimbrado)
        return NextResponse.json({ error: error.message, problemas: error.problemas }, { status: 400 });
      throw error;
    }
  }

  if (accion === "cancelar") {
    if (factura.estado === "cancelada") return badRequest("Esta factura ya está cancelada");

    const motivo = String(body?.motivo ?? "").trim();
    if (!motivo) return badRequest("Captura el motivo de la cancelación");

    // Una factura timbrada existe ante el SAT: cancelarla solo en el sistema la
    // dejaría viva fiscalmente. Se cancela primero allá, con su motivo del
    // catálogo, y solo si el SAT la acepta se marca aquí.
    if (factura.timbrado?.estado === "timbrada") {
      const motivoSat = String(body?.motivoSat ?? "");
      if (!(MOTIVOS_CANCELACION as readonly { value: string }[]).some((m) => m.value === motivoSat))
        return badRequest("Elige el motivo de cancelación del SAT (01 a 04)");
      const folioSustitucion = String(body?.folioSustitucion ?? "").trim();
      if (motivoSat === "01" && !folioSustitucion)
        return badRequest("El motivo 01 exige el UUID de la factura que sustituye a esta");

      try {
        const cancelada = await cancelarFacturaEnSat(
          factura,
          motivoSat as MotivoCancelacion,
          folioSustitucion,
          session.userId,
          motivo,
        );
        return NextResponse.json(JSON.parse(JSON.stringify(cancelada)));
      } catch (error) {
        if (error instanceof ErrorTimbrado)
          return NextResponse.json({ error: error.message, problemas: error.problemas }, { status: 400 });
        throw error;
      }
    }

    factura.estado = "cancelada";
    factura.motivoCancelacion = motivo;
    factura.canceladaEn = new Date();
    factura.canceladaPorId = session.userId;
    await factura.save();
    return NextResponse.json(JSON.parse(JSON.stringify(factura)));
  }

  return badRequest("Acción inválida");
}
