import type { Metadata } from "next";
import { timingSafeEqual } from "node:crypto";
import { connectDB } from "@/lib/db";
import { obtenerConfiguracionOperacion, zonaCedis } from "@/lib/operacion";
import { cargarRol } from "@/lib/rolDelDia";
import { fechaEnZona } from "@/lib/zonasHorarias";
import { ZonaHorariaProvider } from "@/components/ZonaHorariaProvider";
import EventoRuta from "@/models/EventoRuta";
import Incidencia from "@/models/Incidencia";
import { PantallaRutas } from "./PantallaRutas";

// Pantalla del área operativa: la TV del CEDIS muestra el rol de entregas del
// día. No inicia sesión (nadie va a teclear una contraseña en la tele); entra
// con la llave que se genera en Reglas de surtido y que se puede cambiar.
// Solo muestra nombres, horarios, tiendas y folios: nada de importes.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rutas del día | Titos CEDIS" };

function llaveValida(recibida: string, esperada: string) {
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function PantallaRutasPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  await connectDB();
  const config = await obtenerConfiguracionOperacion();
  if (!t || !llaveValida(t, config.pantallaToken)) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-950 p-8 text-center text-white">
        <div>
          <p className="text-3xl font-bold">Pantalla sin autorizar</p>
          <p className="mt-3 text-lg text-white/60">Ábrela desde Operación CEDIS → Rol de entregas → Abrir pantalla.</p>
        </div>
      </main>
    );
  }
  const zona = await zonaCedis();
  const fecha = fechaEnZona(new Date(), zona);
  const [rol, eventos, incidenciasAbiertas] = await Promise.all([
    cargarRol(fecha),
    // Los escaneos son muchos: en la TV solo va lo que el almacén tiene que ver.
    EventoRuta.find({ fecha, tipo: { $ne: "escaneo" } }).sort({ en: -1 }).limit(6).select("tipo salidaNombre detalle en").lean(),
    Incidencia.countDocuments({ estado: "abierta" }),
  ]);
  return (
    <ZonaHorariaProvider zona={zona}>
      <PantallaRutas rol={JSON.parse(JSON.stringify(rol))} eventos={JSON.parse(JSON.stringify(eventos))} incidenciasAbiertas={incidenciasAbiertas} />
    </ZonaHorariaProvider>
  );
}
