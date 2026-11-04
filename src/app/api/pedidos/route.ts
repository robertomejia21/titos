import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import Producto from "@/models/Producto";
import SolicitudProductoNuevo from "@/models/SolicitudProductoNuevo";
import "@/models/Sucursal"; // necesario para que populate("sucursalId") funcione
import "@/models/Empleado"; // necesario para que populate("repartidorId") funcione
import "@/models/User"; // necesario para que populate("surtidoPorId"/"recibidoPorId") funcione
import { requireSession, unauthorized, forbidden, badRequest, generateFolio, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { zonaHorariaDeSucursal } from "@/lib/credito";
import { evento } from "@/lib/logistica";
import { estadoTemporada, textoMesDia } from "@/lib/temporadas";
import { puedeVerMontosTraspasos, sinMontos } from "@/lib/montosTraspasos";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const filter: Record<string, unknown> = {};
  if (session.role === "sucursal") {
    filter.sucursalId = session.sucursalId;
  } else {
    const url = new URL(req.url);
    const sucursalId = url.searchParams.get("sucursalId");
    const estado = url.searchParams.get("estado");
    if (sucursalId) filter.sucursalId = sucursalId;
    if (estado) filter.estado = estado;
  }

  const pedidos = await Pedido.find(filter)
    .sort({ createdAt: -1 })
    .populate("sucursalId", "nombre whatsapp")
    .populate("repartidorId", "nombre whatsapp puesto")
    .populate("surtidorId", "nombre whatsapp puesto")
    .populate("cargadorId", "nombre puesto")
    .populate("surtidoPorId", "nombre")
    .populate("recibidoPorId", "nombre")
    .select("-historial")
    .lean();
  return NextResponse.json((await puedeVerMontosTraspasos(session)) ? pedidos : pedidos.map(sinMontos));
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pedidos.crear")) return sinPermiso("pedidos.crear");
  if (session.role !== "sucursal" || !session.sucursalId) return forbidden();

  const body = await req.json().catch(() => null);
  const items: { productoId: string; cantidad: number }[] = body?.items ?? [];
  const solicitudesNuevas: {
    nombreSugerido: string;
    descripcion?: string;
    unidad: "pieza" | "kg";
    cantidadSugerida: number;
  }[] = body?.solicitudesNuevas ?? [];

  if (items.length === 0 && solicitudesNuevas.length === 0) {
    return badRequest("El pedido debe incluir al menos un producto existente o una solicitud de producto nuevo");
  }

  await connectDB();

  let pedido = null;

  if (items.length > 0) {
    const productoIds = items.map((i) => i.productoId);
    const productos = await Producto.find({ _id: { $in: productoIds } });
    const productoMap = new Map(productos.map((p) => [String(p._id), p]));

    // Candado de temporada: fuera de fechas y agotado en el CEDIS no se pide.
    const dia = todayCorte(await zonaHorariaDeSucursal(session.sucursalId));
    const bloqueados = productos.filter((p) => estadoTemporada(p.temporada, dia, p.existenciaMatriz ?? 0) === "bloqueado");
    if (bloqueados.length) {
      return badRequest(
        `Fuera de temporada y agotado en el CEDIS: ${bloqueados.map((p) => `${p.nombre} (vuelve el ${textoMesDia(p.temporada?.inicio)})`).join(", ")}. Quítalo del pedido.`
      );
    }

    const pedidoItems = [];
    for (const item of items) {
      const producto = productoMap.get(item.productoId);
      const cantidad = Number(item.cantidad);
      if (!producto || !cantidad || cantidad <= 0) {
        return badRequest("Producto inválido o cantidad inválida en el pedido");
      }
      pedidoItems.push({
        productoId: producto._id,
        nombreProducto: producto.nombre,
        categoria: producto.categoria,
        unidad: producto.unidad,
        requierePesaje: producto.requierePesaje,
        precioVenta: producto.precioVenta ?? 0,
        cantidadPedida: cantidad,
      });
    }

    pedido = await Pedido.create({
      folio: generateFolio("PED"),
      sucursalId: session.sucursalId,
      fecha: new Date(),
      corte: todayCorte(await zonaHorariaDeSucursal(session.sucursalId)),
      estado: "pendiente",
      items: pedidoItems,
      capturadoPorId: session.userId,
      capturadoPorNombre: session.nombre ?? "",
      historial: [evento(session, "capturado", `${pedidoItems.length} producto(s)`)],
    });
  }

  const solicitudesCreadas = [];
  for (const s of solicitudesNuevas) {
    if (!s.nombreSugerido || !s.unidad || !s.cantidadSugerida) continue;
    const solicitud = await SolicitudProductoNuevo.create({
      sucursalId: session.sucursalId,
      pedidoId: pedido?._id ?? null,
      nombreSugerido: s.nombreSugerido,
      descripcion: s.descripcion ?? "",
      unidad: s.unidad,
      cantidadSugerida: s.cantidadSugerida,
    });
    solicitudesCreadas.push(solicitud);
  }

  return NextResponse.json({ pedido, solicitudes: solicitudesCreadas }, { status: 201 });
}
