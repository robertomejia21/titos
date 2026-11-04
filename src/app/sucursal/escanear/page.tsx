import { ScanLine } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { EscanerQR } from "@/components/EscanerQR";
import { IncidenciasManager } from "@/components/IncidenciasManager";

export default async function EscanearTiendaPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  return (
    <div>
      <PageHeader
        title="Recibir cajas"
        description="Escanea el QR de cada caja al llegar. Si la caja es de otra sucursal, el sistema te avisa y abre la incidencia para el CEDIS."
        icon={ScanLine}
      />
      <EscanerQR puntos={["recepcion"]} codigoInicial={c} rutaFolio="/sucursal/pedidos/" />
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-titos-green-900">Incidencias de tu sucursal</h2>
        <IncidenciasManager esMatriz={false} rutaFolio="/sucursal/pedidos/" />
      </div>
    </div>
  );
}
