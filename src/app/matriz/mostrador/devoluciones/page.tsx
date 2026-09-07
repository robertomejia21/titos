import { RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { DevolucionesManager } from "@/components/sucursal/DevolucionesManager";
import { connectDB } from "@/lib/db";
import { obtenerMostradorMatriz } from "@/lib/puntoVenta";

export const dynamic = "force-dynamic";

export default async function DevolucionesMostradorPage() {
  await connectDB();
  const mostrador = await obtenerMostradorMatriz();

  return (
    <div>
      <PageHeader
        title="Devoluciones del mostrador"
        description="Devuelve productos de una venta de matriz dentro de las primeras 48 horas y reembolsa al cliente"
        icon={RotateCcw}
      />
      <DevolucionesManager sucursalNombre={mostrador?.nombre ?? "Matriz"} />
    </div>
  );
}
