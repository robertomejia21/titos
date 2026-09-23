import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { WhatsAppMonitor } from "@/components/matriz/WhatsAppMonitor";

// Pantalla de alto completo: el monitor reparte el alto entre la lista y la
// conversación, y cada columna hace su propio scroll (ver MatrizMain).
export default function WhatsAppPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <PageHeader
          title="Monitor de WhatsApp"
          description="Consulta y responde las conversaciones de la instancia de WhatsApp conectada al sistema"
          icon={MessageCircle}
        />
      </div>
      <WhatsAppMonitor />
    </div>
  );
}
