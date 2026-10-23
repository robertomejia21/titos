import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { MinimosManager } from "@/components/matriz/MinimosManager";

export default function MinimosPage() {
  return (
    <div>
      <PageHeader
        title="Mínimos y productos clave"
        description="Mínimos del CEDIS en cajas o tarimas, con ajuste de temporada alta; lo que queda bajo mínimo se manda a Compras"
        icon={Gauge}
      />
      <MinimosManager />
    </div>
  );
}
