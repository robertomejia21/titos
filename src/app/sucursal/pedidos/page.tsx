import Link from "next/link";
import { getSession } from "@/lib/getSession";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import { Card, PageHeader, Button, EstadoBadge, EmptyState, formatMoney } from "@/components/ui";
import { montoLineaPedido } from "@/lib/montoPedido";
import { puedeVerMontosTraspasos } from "@/lib/montosTraspasos";

export const dynamic = "force-dynamic";

export default async function MisPedidosPage() {
  const session = await getSession();
  await connectDB();

  const pedidos = await Pedido.find({ sucursalId: session?.sucursalId }).sort({ createdAt: -1 }).lean();
  const verMontos = await puedeVerMontosTraspasos(session);
  const activos = pedidos.filter((p) => p.estado !== "recibido");

  const enProceso = activos.filter((p) => p.estado === "pendiente" || p.estado === "nivelado").length;
  const listosParaRecibir = activos.filter((p) => p.estado === "surtido").length;
  const montoActivo = activos.reduce(
    (sum, p) => sum + p.items.reduce((s: number, i: (typeof p.items)[number]) => s + montoLineaPedido(i), 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="Mis pedidos"
        description="Estado e historial de tus pedidos a la matriz"
        action={
          <Link href="/sucursal/nuevo-pedido">
            <Button>Levantar nuevo pedido</Button>
          </Link>
        }
      />

      <div className={`mb-6 grid grid-cols-2 gap-4 ${verMontos ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <Card>
          <p className="text-sm text-black/50">Pedidos activos</p>
          <p className="mt-1 text-2xl font-bold text-titos-green-900">{activos.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">En proceso en matriz</p>
          <p className="mt-1 text-2xl font-bold text-sky-700">{enProceso}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/50">Listos para recibir</p>
          <p className="mt-1 text-2xl font-bold text-titos-orange-600">{listosParaRecibir}</p>
        </Card>
        {verMontos ? (
          <Card>
            <p className="text-sm text-black/50">Monto en pedidos activos</p>
            <p className="mt-1 text-2xl font-bold text-titos-green-900">{formatMoney(montoActivo)}</p>
          </Card>
        ) : null}
      </div>

      <Card>
        {pedidos.length === 0 ? (
          <EmptyState message="Todavía no has hecho pedidos." />
        ) : (
          <ul className="divide-y divide-black/5">
            {pedidos.map((p) => (
              <li key={p._id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <Link href={`/sucursal/pedidos/${p._id}`} className="font-medium hover:underline">
                    {p.folio}
                  </Link>
                  <p className="text-xs text-black/40">
                    corte {p.corte} · {p.items.length} productos
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {verMontos ? (
                    <span className="font-medium text-titos-green-900">
                      {formatMoney(p.items.reduce((sum: number, i: (typeof p.items)[number]) => sum + montoLineaPedido(i), 0))}
                    </span>
                  ) : null}
                  <EstadoBadge estado={p.estado} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-black/40">
        Recuerda: los pedidos levantados antes de las 4:00 pm se surten al día siguiente.
      </p>
    </div>
  );
}
