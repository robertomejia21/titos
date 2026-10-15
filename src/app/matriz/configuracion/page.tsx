import { Settings } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ConfiguracionManager } from "@/components/matriz/ConfiguracionManager";

export default function ConfiguracionPage() {
  return (
    <div>
      <PageHeader
        title="Configuración"
        description="Ajustes generales del sistema, ordenados por tema"
        icon={Settings}
      />
      <ConfiguracionManager />
    </div>
  );
}
