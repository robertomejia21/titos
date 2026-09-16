import { redirect } from "next/navigation";
import { getSession } from "@/lib/getSession";
import { Sidebar } from "@/components/Sidebar";
import { SucursalMain } from "@/components/sucursal/SucursalMain";
import { connectDB } from "@/lib/db";
import Sucursal from "@/models/Sucursal";
import { ZonaHorariaProvider } from "@/components/ZonaHorariaProvider";
import { ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import { permisosDeSesion } from "@/lib/permisos";

export default async function SucursalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "sucursal") redirect("/login");

  await connectDB();
  const sucursal = await Sucursal.findById(session.sucursalId).select("nombre zonaHoraria").lean();
  const sucursalNombre = (sucursal as { nombre?: string } | null)?.nombre ?? "";
  const zonaHoraria = (sucursal as { zonaHoraria?: string } | null)?.zonaHoraria || ZONA_HORARIA_DEFAULT;
  const sucursalRol = session.sucursalRol === "ventas" ? "ventas" : "admin";

  return (
    <ZonaHorariaProvider zona={zonaHoraria}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar
          role="sucursal"
          nombre={session.nombre}
          sucursalNombre={sucursalNombre}
          sucursalRol={sucursalRol}
          permisos={permisosDeSesion(session)} permisosIndividuales={session.permisosIndividuales}
        />
        <SucursalMain>{children}</SucursalMain>
      </div>
    </ZonaHorariaProvider>
  );
}
