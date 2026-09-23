import { redirect } from "next/navigation";
import { getSession } from "@/lib/getSession";
import { Sidebar } from "@/components/Sidebar";
import { MatrizMain } from "@/components/matriz/MatrizMain";
import { connectDB } from "@/lib/db";
import { obtenerMostradorMatriz } from "@/lib/puntoVenta";
import { ZonaHorariaProvider } from "@/components/ZonaHorariaProvider";
import { ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import { permisosDeSesion } from "@/lib/permisos";

export default async function MatrizLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "matriz") redirect("/login");

  // El mostrador define la zona horaria con la que matriz cobra y hace su corte.
  await connectDB();
  const mostrador = await obtenerMostradorMatriz();
  const zonaHoraria = mostrador?.zonaHoraria || ZONA_HORARIA_DEFAULT;

  return (
    <ZonaHorariaProvider zona={zonaHoraria}>
      <div data-davinci-session="authenticated" className="flex min-h-screen flex-col md:flex-row">
        <Sidebar role="matriz" nombre={session.nombre} permisos={permisosDeSesion(session)} permisosIndividuales={session.permisosIndividuales} />
        <MatrizMain>{children}</MatrizMain>
      </div>
    </ZonaHorariaProvider>
  );
}
