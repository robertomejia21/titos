import { RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { DevolucionesManager } from "@/components/sucursal/DevolucionesManager";
import { getSession } from "@/lib/getSession";
import { connectDB } from "@/lib/db";
import Sucursal from "@/models/Sucursal";

export const dynamic = "force-dynamic";

export default async function DevolucionesSucursalPage() {
  // El nombre va impreso en el ticket de la devolución.
  const session = await getSession();
  await connectDB();
  const sucursal = session?.sucursalId
    ? await Sucursal.findById(session.sucursalId).select("nombre").lean()
    : null;
  const sucursalNombre = (sucursal as { nombre?: string } | null)?.nombre ?? "";

  return (
    <div>
      <PageHeader
        title="Devoluciones"
        description="Devuelve productos de una venta dentro de las primeras 48 horas y reembolsa al cliente"
        icon={RotateCcw}
      />
      <DevolucionesManager sucursalNombre={sucursalNombre} />
    </div>
  );
}
