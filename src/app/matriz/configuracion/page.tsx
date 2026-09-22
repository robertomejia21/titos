import { Settings } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { ConfiguracionManager } from "@/components/matriz/ConfiguracionManager";

export default function ConfiguracionPage() {
  return (
    <div>
      <PageHeader
        title="Configuración"
        description="Ajustes generales del sistema: conexión de WhatsApp, días y horario laborales"
        icon={Settings}
      />
      <Link href="/matriz/equipos-caja" className="mb-5 block rounded-xl border border-black/10 bg-white p-4 text-titos-green-800 hover:bg-titos-green-50">
        <strong>Equipos de caja →</strong><span className="mt-1 block text-sm">Báscula, lector y terminal bancaria: configuración por sucursal, pruebas y guía de instalación.</span>
      </Link>
      <ConfiguracionManager />
    </div>
  );
}
