import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { IncidenciasManager } from "@/components/IncidenciasManager";

export default function IncidenciasPage() {
  return (
    <div>
      <PageHeader
        title="Incidencias de entrega"
        description="Cajas en la sucursal equivocada, faltantes, dañadas, folios devueltos y mermas, con su historial de comentarios."
        icon={TriangleAlert}
      />
      <IncidenciasManager esMatriz rutaFolio="/matriz/pedidos/folio/" />
    </div>
  );
}
