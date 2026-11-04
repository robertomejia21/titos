import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, todayCorte } from "@/lib/apiAuth";
import { consumoPorTienda } from "@/lib/consumo";
import { obtenerConfiguracionOperacion } from "@/lib/operacion";

// Vista consolidada por producto de los pedidos ya pasados por el Nivelador:
// cuánto había en almacén, cuánto pidió cada sucursal y cuánto falta comprar.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  await connectDB();

  const nivelados = { estado: { $ne: "pendiente" } };
  const cortesDisponibles = ((await Pedido.distinct("corte", nivelados)) as string[]).sort().reverse();

  const url = new URL(req.url);
  const corteParam = url.searchParams.get("corte");
  const corte = corteParam || cortesDisponibles[0] || todayCorte();

  const [sucursales, pedidos] = await Promise.all([
    Sucursal.find({}).sort({ nombre: 1 }).lean(),
    Pedido.find({ corte, estado: { $ne: "pendiente" } }).lean(),
  ]);

  type SucursalCantidades = { pedido: number; asignado: number; stock?: number; consumoDiario?: number; sugerido?: number };

  type Fila = {
    productoId: string;
    nombreProducto: string;
    categoria: string;
    porSucursal: Record<string, SucursalCantidades>;
    totalPedido: number;
    totalAsignado: number;
  };

  const porProducto = new Map<string, Fila>();

  for (const pedido of pedidos) {
    const sucursalId = String(pedido.sucursalId);
    for (const item of pedido.items) {
      if (item.cantidadAsignada === null || item.cantidadAsignada === undefined) continue;
      const key = String(item.productoId);
      const fila = porProducto.get(key) ?? {
        productoId: key,
        nombreProducto: item.nombreProducto,
        categoria: item.categoria || "otros",
        porSucursal: {} as Record<string, SucursalCantidades>,
        totalPedido: 0,
        totalAsignado: 0,
      };
      const cantidades = fila.porSucursal[sucursalId] ?? { pedido: 0, asignado: 0 };
      cantidades.pedido += item.cantidadPedida;
      cantidades.asignado += item.cantidadAsignada;
      fila.porSucursal[sucursalId] = cantidades;
      fila.totalPedido += item.cantidadPedida;
      fila.totalAsignado += item.cantidadAsignada;
      porProducto.set(key, fila);
    }
  }

  const productoIds = Array.from(porProducto.keys());
  const productos = await Producto.find({ _id: { $in: productoIds } }).lean();
  const existenciaPorProducto = new Map(productos.map((p) => [String(p._id), p.existenciaMatriz]));

  // Patrón de consumo de cada tienda (antes del corte): sugiere cuánto mandar,
  // también a la tienda que no lo pidió pero lo vende.
  const operacion = await obtenerConfiguracionOperacion();
  const ventanaDias = operacion.nivelador?.ventanaDias ?? 30;
  const diasCobertura = operacion.nivelador?.diasCobertura ?? 2;
  const consumo = await consumoPorTienda(productoIds, corte, { ventanaDias, diasCobertura });
  for (const fila of porProducto.values()) {
    for (const [sucursalId, productosTienda] of consumo) {
      const c = productosTienda.get(fila.productoId);
      if (!c) continue;
      fila.porSucursal[sucursalId] = { ...(fila.porSucursal[sucursalId] ?? { pedido: 0, asignado: 0 }), ...c };
    }
  }

  const filas = Array.from(porProducto.values())
    .map((fila) => ({
      productoId: fila.productoId,
      nombreProducto: fila.nombreProducto,
      categoria: fila.categoria,
      // El Nivelador ya restó lo asignado de existenciaMatriz; se reconstruye
      // el inventario previo sumando de vuelta lo asignado a las sucursales.
      existenciaMatriz: (existenciaPorProducto.get(fila.productoId) ?? 0) + fila.totalAsignado,
      porSucursal: fila.porSucursal,
      pendienteCompra: Math.max(fila.totalPedido - fila.totalAsignado, 0),
    }))
    .sort((a, b) => a.nombreProducto.localeCompare(b.nombreProducto));

  return NextResponse.json({
    corte,
    cortesDisponibles,
    sucursales: sucursales.map((s) => ({ _id: String(s._id), nombre: s.nombre })),
    productos: filas,
    consumo: { ventanaDias, diasCobertura },
  });
}
