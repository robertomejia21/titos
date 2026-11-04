import { Route } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { SolicitudesRutaManager } from "@/components/SolicitudesRutaManager";

export default function SolicitudesRutaTiendaPage() {
  return (
    <div>
      <PageHeader
        title="Solicitudes de ruta"
        description="Pide al CEDIS una entrega con dirección, zona y horario. Te confirman la salida o te proponen otro horario por aquí y por WhatsApp."
        icon={Route}
      />
      <SolicitudesRutaManager esMatriz={false} />
    </div>
  );
}
