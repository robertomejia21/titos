import { Apple } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { PerecederosManager } from "@/components/matriz/PerecederosManager";

export default function PerecederosPage() {
  return (
    <div>
      <PageHeader
        title="Rotación de perecederos"
        description="Qué tiene que salir primero, qué está por pasarse y dónde llegó más de lo que se vende"
        icon={Apple}
      />
      <PerecederosManager />
    </div>
  );
}
