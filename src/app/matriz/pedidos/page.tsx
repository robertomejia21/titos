import { Suspense } from "react";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { PedidosManager } from "@/components/matriz/PedidosManager";
import { getSession } from "@/lib/getSession";
import { connectDB } from "@/lib/db";
import { puedeVerMontosTraspasos } from "@/lib/montosTraspasos";

export const dynamic = "force-dynamic";

export default async function PedidosPage() {
  const session = await getSession();
  await connectDB();
  const verMontos = await puedeVerMontosTraspasos(session);

  return (
    <div>
      <PageHeader
        title="Pedidos de sucursales"
        description="Corte de pedidos, Nivelador, surtido, cajas y pre-carga a las salidas del día"
        icon={ClipboardList}
      />
      <Suspense>
        <PedidosManager verMontos={verMontos} />
      </Suspense>
    </div>
  );
}
