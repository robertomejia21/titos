import { Suspense } from "react";
import { Route } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { RolEntregasManager } from "@/components/matriz/RolEntregasManager";
import { BitacoraRutas } from "@/components/matriz/BitacoraRutas";

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
        <h2 className="mb-3 text-lg font-semibold text-titos-green-900">Bitácora de rutas</h2>
        <BitacoraRutas />
      </section>
    </div>
  );
}
