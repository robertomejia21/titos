import { Tag } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { PromocionesManager } from "@/components/matriz/PromocionesManager";

export default function PromocionesPage() {
  return <div>
    <PageHeader title="Promociones" description="Prepara descuentos por producto o categoría, sucursales y fechas." icon={Tag} />
    <PromocionesManager />
  </div>;
}
