import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ReglasSurtidoManager } from "@/components/matriz/ReglasSurtidoManager";

export default function ReglasSurtidoPage() {
  return (
    <div>
      <PageHeader
        title="Reglas de surtido"
        description="Prorrateo cuando no alcanza, prioridad entre tiendas, segunda vuelta, temporada alta y lista diaria de faltantes"
        icon={SlidersHorizontal}
      />
      <ReglasSurtidoManager />
    </div>
  );
}
