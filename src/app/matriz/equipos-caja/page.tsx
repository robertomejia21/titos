import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { EquiposCajaManager } from "@/components/matriz/EquiposCajaManager";

export default function EquiposCajaPage() {
  return <div><PageHeader title="Equipos de caja" description="Báscula, lector y terminal bancaria por sucursal" icon={Wrench} /><EquiposCajaManager /></div>;
}
