"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { useHoraActual } from "@/components/RelojZona";
import { formatFechaLarga, horaEnZona } from "@/lib/zonasHorarias";
import type { RolVista } from "@/lib/rolDelDia";

// La TV está lejos y con poca luz por la mañana: letra muy grande, alto
// contraste y nada que haya que leer de cerca. Se recarga sola cada minuto.

const RECARGA_MS = 60_000;

const TIPO_LABEL: Record<string, string> = {
  primera_vuelta: "1ª vuelta",
  segunda_vuelta: "2ª vuelta",
  especial: "Especial",
};
const ESTADO: Record<string, { texto: string; clase: string }> = {
  programada: { texto: "Programada", clase: "bg-white/10 text-white" },
  en_ruta: { texto: "En ruta", clase: "bg-amber-400 text-black" },
  completada: { texto: "Completada", clase: "bg-emerald-500 text-black" },
};

export function PantallaRutas({ rol }: { rol: RolVista }) {
  const router = useRouter();
  const zona = useZonaHoraria();
  const hora = useHoraActual();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), RECARGA_MS);
    return () => clearInterval(id);
  }, [router]);

  // La siguiente salida programada se resalta: es la que el almacén tiene que
  // tener lista. Se compara en HH:MM de 24 h (el reloj de arriba es de 12 h).
  // `hora` solo sirve para saber que ya se montó y para re-evaluar cada segundo.
  const ahora24 = hora ? horaEnZona(new Date(), zona) : null;
  const siguiente = ahora24 ? rol.salidas.find((s) => s.estado === "programada" && s.horaSalida >= ahora24) : undefined;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white xl:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-5">
        <div>
          <p className="text-xl font-semibold uppercase tracking-widest text-emerald-400">Titos CEDIS · Rutas del día</p>
          <p className="mt-1 text-3xl font-bold capitalize">{formatFechaLarga(new Date(), zona)}</p>
        </div>
        <p className="font-mono text-7xl font-bold tabular-nums">{hora || " "}</p>
      </header>

      {rol.salidas.length === 0 ? (
        <p className="mt-24 text-center text-4xl text-white/60">Todavía no se publica el rol de hoy.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {rol.salidas.map((s) => {
            const estado = ESTADO[s.estado] ?? ESTADO.programada;
            const esSiguiente = siguiente?._id === s._id;
            return (
              <section
                key={s._id}
                className={`rounded-3xl border-4 p-6 ${esSiguiente ? "border-amber-400 bg-amber-400/10" : s.estado === "completada" ? "border-white/5 bg-white/5 opacity-60" : "border-white/15 bg-white/5"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-baseline gap-4">
                    <span className="font-mono text-6xl font-bold tabular-nums">{s.horaSalida}</span>
                    <span className="text-4xl font-bold">{s.nombre}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xl font-bold">
                    {esSiguiente ? <span className="rounded-full bg-amber-400 px-4 py-1 text-black">Siguiente</span> : null}
                    <span className={`rounded-full px-4 py-1 ${estado.clase}`}>{estado.texto}</span>
                    <span className="rounded-full bg-white/10 px-4 py-1">{TIPO_LABEL[s.tipo] ?? s.tipo}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 text-3xl md:grid-cols-2">
                  <p>
                    <span className="text-white/50">Chofer </span>
                    <span className="font-bold">{s.choferNombre || "Sin asignar"}</span>
                  </p>
                  <p>
                    <span className="text-white/50">Unidad </span>
                    <span className="font-bold">{s.vehiculoNombre || "Sin asignar"}</span>
                    {s.vehiculoRefrigerado ? <span className="ml-2 text-cyan-300">❄</span> : null}
                  </p>
                </div>

                {s.paradas.length ? (
                  <ol className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-2xl">
                    {s.paradas.map((p, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500 font-bold text-black">{i + 1}</span>
                        <span className={p.tipo === "sucursal" ? "font-semibold" : "italic text-amber-200"}>{p.nombre}</span>
                        {i < s.paradas.length - 1 ? <span className="text-white/30">→</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}

                {s.pedidos.length ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {s.pedidos.map((p) => (
                      <span key={p._id} className="rounded-xl bg-white px-4 py-2 font-mono text-2xl font-bold text-black">
                        {p.folio}
                        <span className="ml-2 font-sans text-lg font-semibold text-black/60">{p.sucursalNombre.replace(/^Sucursal /, "")}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 text-2xl text-white/40">Sin folios asignados</p>
                )}

                {s.notas ? <p className="mt-4 text-2xl text-amber-200">{s.notas}</p> : null}
              </section>
            );
          })}
        </div>
      )}

      {rol.pedidosSinSalida.length ? (
        <p className="mt-8 rounded-2xl bg-red-600 p-5 text-3xl font-bold">
          {rol.pedidosSinSalida.length} pedido(s) listos sin ruta: {rol.pedidosSinSalida.map((p) => p.folio).join(", ")}
        </p>
      ) : null}
    </main>
  );
}
