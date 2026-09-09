import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { HistorialVentasManager } from "@/components/matriz/HistorialVentasManager";

export const dynamic = "force-dynamic";

export default function HistorialVentasPage() {
  return (
    <div>
      <PageHeader
        title="Historial de ventas"
        description="Lo cobrado en cada punto de venta, con filtros por sucursal y por fecha"
        icon={TrendingUp}
      />
      <Link href="/matriz/reportes/productos" className="mb-4 inline-block text-sm text-titos-green-700 underline">Comparar ventas por producto y sucursal</Link>
      <HistorialVentasManager />
    </div>
  );
}
