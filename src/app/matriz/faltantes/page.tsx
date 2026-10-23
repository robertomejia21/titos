import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { FaltantesManager } from "@/components/matriz/FaltantesManager";

export default function FaltantesPage() {
  return (
    <div>
      <PageHeader
        title="Faltantes del día"
        description="Lo que llegó contra lo que se pidió a cada proveedor, devoluciones, bajo mínimo y perecederos; se manda por WhatsApp"
        icon={ListChecks}
      />
      <FaltantesManager />
    </div>
  );
}
