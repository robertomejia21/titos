import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { WhatsAppMonitor } from "@/components/matriz/WhatsAppMonitor";

export default function WhatsAppPage() {
  return (
    <div>
      <PageHeader
        title="Monitor de WhatsApp"
        description="Consulta y responde las conversaciones de la instancia de WhatsApp conectada al sistema"
        icon={MessageCircle}
      />
      <WhatsAppMonitor />
    </div>
  );
}
