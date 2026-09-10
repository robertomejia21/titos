import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ReporteProductos } from "@/components/matriz/ReporteProductos";
import { getSession } from "@/lib/getSession";
import { tienePermiso } from "@/lib/permisos";
export const dynamic = "force-dynamic";
export default async function ReporteProductosPage() {
  const session = await getSession();
  return <div>
    <PageHeader title="Comparación por producto" description="Ventas por SKU y sucursal en el periodo seleccionado" icon={BarChart3} />
    {session && tienePermiso(session, "reportes.ventas") ? <Link href="/matriz/reportes/ventas" className="mb-4 inline-block text-sm text-titos-green-700 underline">Ver historial de tickets</Link> : null}
    <ReporteProductos />
  </div>;
}
