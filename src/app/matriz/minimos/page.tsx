import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { MinimosManager } from "@/components/matriz/MinimosManager";
import { TemporadasManager } from "@/components/matriz/TemporadasManager";
import { getSession } from "@/lib/getSession";
import { tienePermiso } from "@/lib/permisos";

export default async function MinimosPage() {
  const session = await getSession();
  return (
    <div>
      <PageHeader
        title="Mínimos y productos clave"
        description="Mínimos del CEDIS en cajas o tarimas, con ajuste de temporada alta; lo que queda bajo mínimo se manda a Compras"
        icon={Gauge}
      />
      <MinimosManager />
      <div className="mt-8">
        <TemporadasManager editable={!!session && tienePermiso(session, "inventario.administrar")} />
      </div>
    </div>
  );
}
