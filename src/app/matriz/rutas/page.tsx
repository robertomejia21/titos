import { Suspense } from "react";
import { Route } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { RolEntregasManager } from "@/components/matriz/RolEntregasManager";
import { BitacoraRutas } from "@/components/matriz/BitacoraRutas";
import { SolicitudesRutaManager } from "@/components/SolicitudesRutaManager";

export default function RutasPage() {
  return (
    <div>
      <PageHeader
        title="Rol de entregas"
        description="El sistema sugiere unidad, chofer y folios de cada ruta; el coordinador lo ajusta y se proyecta en la pantalla del área operativa"
        icon={Route}
      />
      <Suspense>
        <RolEntregasManager />
      </Suspense>
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold text-titos-green-900">Solicitudes de ruta de las tiendas</h2>
        <p className="mb-3 text-sm text-black/50">La ★ marca la salida sugerida: la apta (con frío si hace falta) que sale más cerca del horario pedido y ya tiene chofer.</p>
        <SolicitudesRutaManager esMatriz />
      </section>
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-titos-green-900">Bitácora de rutas</h2>
        <BitacoraRutas />
      </section>
    </div>
  );
}
