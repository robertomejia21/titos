import type { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import "@/models/Sucursal"; // necesario para que populate("sucursalId") funcione
import "@/models/Empleado"; // necesario para que populate de responsables funcione
import "@/models/User"; // necesario para que populate("surtidoPorId"/"recibidoPorId") funcione
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede, sinPermiso } from "@/lib/apiAuth";
import { puedeEditarCajas } from "@/lib/logistica";
import { puedeVerMontosTraspasos, sinMontos } from "@/lib/montosTraspasos";
import type { SessionPayload } from "@/lib/auth";

// Lo que comparten las rutas que mueven un pedido en el CEDIS: armar cajas,
// asignar responsables y cargarlo a una salida.

/** Lo que muestran el detalle del pedido y su tarjeta: tienda y responsables. */
export const POBLAR_PEDIDO = [
  { path: "sucursalId", select: "nombre whatsapp" },
  { path: "repartidorId", select: "nombre whatsapp puesto" },
  { path: "surtidorId", select: "nombre whatsapp puesto" },
  { path: "cargadorId", select: "nombre puesto" },
  { path: "surtidoPorId", select: "nombre" },
  { path: "recibidoPorId", select: "nombre" },
];

/** El pedido como lo pinta Pedidos, sin montos si la sesión no los puede ver. */
export async function respuestaPedido(id: unknown, session: SessionPayload) {
  const pedido = await Pedido.findById(id).populate(POBLAR_PEDIDO).lean();
  if (!pedido) return null;
  return (await puedeVerMontosTraspasos(session)) ? pedido : sinMontos(pedido);
}

type Resultado =
  | { session: SessionPayload; pedido: InstanceType<typeof Pedido>; error?: undefined }
  | { error: Response; session?: undefined; pedido?: undefined };

/** Sesión de matriz con permiso de surtir y el pedido, listo para editarse. */
export async function cargarPedidoMatriz(req: NextRequest, id: string): Promise<Resultado> {
  const session = await requireSession(req);
  if (!session) return { error: unauthorized() };
  if (session.role !== "matriz") return { error: forbidden() };
  if (!puede(session, "pedidos.surtir")) return { error: sinPermiso("pedidos.surtir") };
  if (!mongoose.isValidObjectId(id)) return { error: notFound("Pedido no encontrado") };
  await connectDB();
  const pedido = await Pedido.findById(id);
  if (!pedido) return { error: notFound("Pedido no encontrado") };
  return { session, pedido };
}

/** Igual, pero solo si las cajas todavía se pueden armar o rearmar. */
export async function cargarPedidoParaCajas(req: NextRequest, id: string): Promise<Resultado> {
  const r = await cargarPedidoMatriz(req, id);
  if (r.error) return r;
  if (!puedeEditarCajas(r.pedido)) {
    return { error: badRequest(r.pedido.carga?.etapa === "en_ruta" ? "El pedido ya salió a ruta: sus cajas ya no se pueden mover" : "Las cajas se arman cuando el pedido ya pasó por el Nivelador") };
  }
  return r;
}

/** Valida el contenido capturado de una caja; regresa el mensaje de error si no sirve. */
export function contenidoCaja(valor: unknown) {
  const items = Array.isArray(valor) ? valor : [];
  if (items.length === 0) return "La caja debe tener al menos un producto";
  const limpios = [];
  for (const i of items as { productoId?: unknown; nombreProducto?: unknown; cantidad?: unknown }[]) {
    const cantidad = Number(i?.cantidad);
    if (!mongoose.isValidObjectId(i?.productoId) || !Number.isFinite(cantidad) || cantidad <= 0) return "Hay un producto o una cantidad inválida en la caja";
    limpios.push({ productoId: String(i.productoId), nombreProducto: String(i.nombreProducto ?? "").slice(0, 200), cantidad });
  }
  return limpios;
}
