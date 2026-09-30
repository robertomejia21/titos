import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/getSession";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import { Card, PageHeader, EstadoBadge, formatMoney } from "@/components/ui";
import { RecepcionForm } from "@/components/sucursal/RecepcionForm";
import { DiferenciaRecepcion } from "@/components/DiferenciaRecepcion";
import { montoLineaPedido } from "@/lib/montoPedido";

export const dynamic = "force-dynamic";

export default async function DetallePedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  await connectDB();
  const pedido = await Pedido.findById(id).lean();
  if (!pedido || String(pedido.sucursalId) !== session.sucursalId) notFound();

  const total = pedido.items.reduce((sum: number, i: (typeof pedido.items)[number]) => sum + montoLineaPedido(i), 0);

  return (
    <div>
      <PageHeader
        title={pedido.folio}
        description={`Corte ${pedido.corte}`}
        action={<EstadoBadge estado={pedido.estado} />}
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-black/50">
                <th className="px-2 py-1.5 text-xs font-medium">Producto</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Pedido</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Asignado</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Surtido</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Recibido</th>
                <th className="px-2 py-1.5 text-xs font-medium">Diferencia</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Precio venta</th>
                <th className="px-2 py-1.5 text-xs font-medium text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((item: (typeof pedido.items)[number]) => (
                <tr key={item.productoId?.toString()} className="border-b border-black/5">
                  <td className="px-2 py-1.5 font-medium">
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      {item.nombreProducto}
                      {item.requierePesaje ? <span className="text-xs text-titos-orange-600">(pesaje)</span> : null}
                      {item.notaRecepcion ? (
                        <span className="max-w-[16rem] truncate text-xs font-normal text-black/70" title={`Nota de recepción: ${item.notaRecepcion}`}>
                          Nota de recepción: {item.notaRecepcion}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {item.cantidadPedida} {item.unidad}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{item.cantidadAsignada ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {item.cantidadSurtida ?? "—"}
                    {item.pesoSurtidoKg ? ` (${item.pesoSurtidoKg} kg)` : ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {item.cantidadRecibida ?? "—"}
                    {item.pesoRecibidoKg ? ` (${item.pesoRecibidoKg} kg)` : ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 [&>p]:mt-0">
                    <DiferenciaRecepcion esperado={item.cantidadSurtida ?? 0} recibido={item.cantidadRecibida} referencia="lo surtido" />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatMoney(item.precioVenta ?? 0)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">{formatMoney(montoLineaPedido(item))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} />
                <td className="whitespace-nowrap px-2 pt-2 text-right text-xs font-semibold uppercase text-black/40">Total</td>
                <td className="whitespace-nowrap px-2 pt-2 text-right font-semibold text-titos-green-900">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {pedido.estado === "surtido" ? (
          <RecepcionForm
            pedidoId={String(pedido._id)}
            items={pedido.items.map((i: (typeof pedido.items)[number]) => ({
              productoId: String(i.productoId),
              nombreProducto: i.nombreProducto,
              unidad: i.unidad,
              requierePesaje: i.requierePesaje,
              cantidadSurtida: i.cantidadSurtida ?? null,
            }))}
          />
        ) : null}
      </Card>
    </div>
  );
}
