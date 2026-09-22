import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import OrdenCompra from "@/models/OrdenCompra";
import "@/models/Sucursal"; // necesario para que populate("sucursalId") funcione
import "@/models/Empleado"; // necesario para que populate("repartidorId") funcione
import "@/models/Proveedor"; // necesario para que populate("proveedorId") funcione
import { requireSession, unauthorized, forbidden, badRequest, notFound } from "@/lib/apiAuth";
import { generarPdfPedido, generarPdfOrdenCompra } from "@/lib/pdf";
import { sendFileByUpload } from "@/lib/greenApi";
import { formatFechaLarga, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  const tipo = body?.tipo;
  const id = body?.id;
  const whatsapp = body?.whatsapp;
  const caption = body?.caption;

  if (tipo !== "pedido" && tipo !== "orden-compra") return badRequest("Tipo de documento inválido");
  if (!id || !whatsapp || !caption) return badRequest("Faltan datos para enviar el documento");

  await connectDB();

  let pdfBytes: Uint8Array;
  let fileName: string;

  if (tipo === "pedido") {
    const pedido = await Pedido.findById(id).populate("sucursalId", "nombre").populate("repartidorId", "nombre").lean();
    if (!pedido) return notFound("Pedido no encontrado");

    pdfBytes = await generarPdfPedido({
      folio: pedido.folio,
      corte: pedido.corte,
      estado: pedido.estado,
      sucursalNombre: (pedido.sucursalId as unknown as { nombre?: string })?.nombre ?? "Sucursal",
      repartidorNombre: (pedido.repartidorId as unknown as { nombre?: string } | null)?.nombre ?? null,
      items: pedido.items,
      cajas: pedido.cajas,
    });
    fileName = `Pedido-${pedido.folio}.pdf`;
  } else {
    const orden = await OrdenCompra.findById(id).populate("proveedorId", "nombre").lean();
    if (!orden) return notFound("Orden de compra no encontrada");

    const fecha = orden.fechaRecepcion ?? orden.fechaCancelacion ?? orden.fechaSolicitud ?? orden.createdAt;

    pdfBytes = await generarPdfOrdenCompra({
      folio: orden.folio,
      estado: orden.estado,
      proveedorNombre: (orden.proveedorId as unknown as { nombre?: string })?.nombre ?? "Proveedor",
      fecha: formatFechaLarga(fecha, ZONA_HORARIA_DEFAULT),
      items: orden.items,
    });
    fileName = `Orden-${orden.folio}.pdf`;
  }

  try {
    await sendFileByUpload(whatsapp, Buffer.from(pdfBytes).toString("base64"), fileName, caption);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
