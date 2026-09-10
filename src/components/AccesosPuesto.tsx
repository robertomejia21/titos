import Link from "next/link";
import { getSession } from "@/lib/getSession";
import { PERMISO_POR_RUTA, PERMISOS, tienePermiso } from "@/lib/permisos";
import { accesoPaginaPuesto } from "@/lib/accesoPuestos";
import { PUESTOS } from "@/lib/puestos";

export async function AccesosPuesto() {
  const session = await getSession();
  if (!session) return null;
  const puesto = PUESTOS.find((p) => p.perfilDocumentoId === session.perfilDocumentoId);
  const rutas = Object.entries(PERMISO_POR_RUTA).filter(([ruta, permiso]) => ruta.startsWith(`/${session.role}/`) && accesoPaginaPuesto(session, ruta) && tienePermiso(session, permiso));
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold text-titos-green-900">{puesto?.nombre ?? "Mis accesos"}</h1>
    <p className="text-black/70">Estos son los módulos disponibles para tu puesto.</p>
    <ul className="space-y-2">{rutas.map(([ruta, permiso]) => <li key={ruta}><Link className="text-titos-green-800 underline" href={ruta}>{PERMISOS.find((p) => p.clave === permiso)?.etiqueta ?? ruta}</Link></li>)}</ul>
    {rutas.length === 0 ? <p>Tu rol no tiene accesos activos. Solicita al administrador que revise tus permisos.</p> : null}
    {puesto ? <div className="rounded-lg bg-amber-50 p-4 text-amber-900"><h2 className="font-semibold">Funciones pendientes de este puesto</h2><p className="mt-2">{puesto.pendientes}</p></div> : null}
  </section>;
}
