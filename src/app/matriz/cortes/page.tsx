import { ArqueosReporte } from "@/components/matriz/ArqueosReporte";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { CortesManager } from "@/components/matriz/CortesManager";

export default function CortesPage() {
  return (
    <div>
      <PageHeader
        title="Corte global"
        description="Cierres de caja de todas las sucursales, con sus retiros de efectivo y dólares"
        icon={ClipboardCheck}
      />
      <ArqueosReporte />
      <CortesManager />
    </div>
  );
}
