import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Producto from "@/models/Producto";
import MovimientoInventario from "@/models/MovimientoInventario";
import { requireSession, unauthorized, forbidden, badRequest, notFound, puede, sinPermiso } from "@/lib/apiAuth";
import { generarSegundaVuelta } from "@/lib/segundaVuelta";
import { obtenerConfiguracionOperacion } from "@/lib/operacion";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "inventario.administrar")) return sinPermiso("inventario.administrar");
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  const productoId = body?.productoId;
  const cantidad = Number(body?.cantidad);
  const pesoKg = body?.pesoKg != null ? Number(body.pesoKg) : null;

  if (!productoId || !cantidad || cantidad <= 0) {
    return badRequest("productoId y cantidad (> 0) son requeridos");
  }

  await connectDB();
  const producto = await Producto.findById(productoId);
  if (!producto) return notFound("Producto no encontrado");

  if (producto.requierePesaje && (!pesoKg || pesoKg <= 0)) {
    return badRequest("Este producto requiere capturar el peso en kg al recibirlo");
  }

  producto.existenciaMatriz += cantidad;
  await producto.save();

  const movimiento = await MovimientoInventario.create({
    tipo: "entrada_proveedor",
    productoId: producto._id,
    nombreProducto: producto.nombre,
    ubicacion: "matriz",
    cantidad,
    pesoKg,
    usuarioId: session.userId,
  });

  // Llegó mercancía: si había pedidos que quedaron cortos, se arma su segunda
  // vuelta igual que al recibir una orden de compra.
  const segundaVuelta = (await obtenerConfiguracionOperacion()).segundaVuelta?.automatica !== false
    ? await generarSegundaVuelta({ productoIds: [String(producto._id)] }).catch((error) => {
        console.error("Error al armar la segunda vuelta", error);
        return null;
      })
    : null;

  return NextResponse.json({ producto, movimiento, segundaVuelta }, { status: 201 });
}
