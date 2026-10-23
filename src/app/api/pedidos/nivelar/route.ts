import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import Producto from "@/models/Producto";
import NecesidadCompra from "@/models/NecesidadCompra";
import { prorratear, type CriterioProrrateo } from "@/lib/prorrateo";
import { mapaPrioridades, obtenerConfiguracionOperacion } from "@/lib/operacion";
import { requireSession, unauthorized, forbidden, puede, sinPermiso } from "@/lib/apiAuth";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pedidos.surtir")) return sinPermiso("pedidos.surtir");
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const corte = typeof body?.corte === "string" ? body.corte : undefined;

  await connectDB();

  const filter: Record<string, unknown> = { estado: "pendiente" };
  if (corte) filter.corte = corte;

  const pedidos = await Pedido.find(filter).sort({ fecha: 1 });
  // La escasez se reparte con el criterio y la prioridad de tiendas que el
  // CEDIS tenga configurados en Reglas de surtido.
  const operacion = await obtenerConfiguracionOperacion();
  const criterio = (operacion.criterioProrrateo ?? "caja_completa") as CriterioProrrateo;
  const prioridades = mapaPrioridades(operacion);

  if (pedidos.length === 0) {
    return NextResponse.json({
      mensaje: "No hay pedidos pendientes por nivelar",
      procesados: 0,
      necesidadesCompra: [],
    });
  }

  type Renglon = { pedido: (typeof pedidos)[number]; itemIndex: number };
  const porProducto = new Map<string, Renglon[]>();

  for (const pedido of pedidos) {
    pedido.items.forEach((item: (typeof pedido.items)[number], idx: number) => {
      const key = String(item.productoId);
      const lista = porProducto.get(key) ?? [];
      lista.push({ pedido, itemIndex: idx });
      porProducto.set(key, lista);
    });
  }

  const necesidadesGeneradas: InstanceType<typeof NecesidadCompra>[] = [];

  for (const [productoId, renglones] of porProducto) {
    const producto = await Producto.findById(productoId);
    if (!producto) continue;

    // Demanda agregada por sucursal (una sucursal puede tener el mismo producto
    // repetido en más de un pedido pendiente).
    const demandaPorSucursal = new Map<string, number>();
    for (const { pedido, itemIndex } of renglones) {
      const sucursalId = String(pedido.sucursalId);
      const cantidad = pedido.items[itemIndex].cantidadPedida;
      demandaPorSucursal.set(sucursalId, (demandaPorSucursal.get(sucursalId) ?? 0) + cantidad);
    }

    const demandas = Array.from(demandaPorSucursal.entries()).map(([sucursalId, cantidad]) => ({
      sucursalId,
      cantidad,
      prioridad: prioridades.get(sucursalId),
    }));

    const asignaciones = prorratear(producto.existenciaMatriz, demandas, { criterio, piezasPorCaja: producto.piezasPorCaja ?? 0 });
    const restantePorSucursal = new Map(asignaciones.map((a) => [a.sucursalId, a.cantidadAsignada]));

    // Repartir la asignación total de cada sucursal entre sus renglones de ese
    // producto, llenando primero los pedidos más antiguos hasta su cantidad pedida.
    let totalAsignado = 0;
    let totalPedido = 0;

    for (const { pedido, itemIndex } of renglones) {
      const sucursalId = String(pedido.sucursalId);
      const item = pedido.items[itemIndex];
      totalPedido += item.cantidadPedida;
      const disponible = restantePorSucursal.get(sucursalId) ?? 0;
      const asignarAqui = Math.min(disponible, item.cantidadPedida);
      item.cantidadAsignada = asignarAqui;
      restantePorSucursal.set(sucursalId, disponible - asignarAqui);
      totalAsignado += asignarAqui;
    }

    producto.existenciaMatriz -= totalAsignado;
    await producto.save();

    const faltante = totalPedido - totalAsignado;
    if (faltante > 0) {
      const pedidosOrigen = Array.from(new Set(renglones.map((r) => String(r.pedido._id))));
      const necesidad = await NecesidadCompra.create({
        productoId: producto._id,
        nombreProducto: producto.nombre,
        cantidadRequerida: faltante,
        motivo: "faltante_pedido",
        pedidosOrigen,
      });
      necesidadesGeneradas.push(necesidad);
    }
  }

  const niveladoEn = new Date();
  for (const pedido of pedidos) {
    pedido.estado = "nivelado";
    pedido.niveladoEn = niveladoEn;
    await pedido.save();
  }

  return NextResponse.json({
    mensaje: "Nivelador ejecutado",
    procesados: pedidos.length,
    criterio,
    necesidadesCompra: necesidadesGeneradas,
  });
}
