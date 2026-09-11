import { PageHeader } from "@/components/ui";
import { ReportesSupervisor } from "@/components/sucursal/ReportesSupervisor";
import { BarChart3 } from "lucide-react";
export default function ReportesPage() {
  return <div><PageHeader title="Reportes globales" description="Consulta todas las tiendas. Tu operación y autorizaciones siguen limitadas a tu sucursal." icon={BarChart3} /><ReportesSupervisor /></div>;
}
