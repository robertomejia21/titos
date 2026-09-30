"use client";

import { useEffect, useState } from "react";
import { Ticket, CreditCard } from "lucide-react";
import { Button, Card, Input, Select, EmptyState, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";

type Emisor = { _id: string; nombre: string; prefijosBin: string[]; activo: boolean };
type Bin = {
  _id: string;
  bin: string;
  emisorId: string | null;
  emisorNombre: string;
  veces: number;
  ultimaVez: string;
};

export function ValesManager() {
  const [emisores, setEmisores] = useState<Emisor[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevoEmisor, setNuevoEmisor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const res = await fetch("/api/vales");
    if (res.ok) {
      const data = await res.json();
      setEmisores(data.emisores ?? []);
      setBins(data.bins ?? []);
    }
    setCargando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  async function crearEmisor() {
    setError(null);
    setGuardando(true);
    const res = await fetch("/api/vales", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nuevoEmisor.trim() }),
    });
    setGuardando(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear el emisor");
      return;
    }
    setNuevoEmisor("");
    cargar();
  }

  async function asignar(bin: string, emisorId: string) {
    if (!emisorId) return;
    const res = await fetch("/api/vales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bin, emisorId }),
    });
    if (res.ok) cargar();
  }

  const sinAsignar = bins.filter((b) => !b.emisorId);
  const asignados = bins.filter((b) => b.emisorId);
  const { pagina: paginaSinAsignar, paginacion: paginacionSinAsignar } = usePaginacion(sinAsignar);
  const { pagina: paginaEmisores, paginacion: paginacionEmisores } = usePaginacion(emisores);

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-1 font-semibold text-titos-green-900">Cómo se identifican las tarjetas</h2>
        <p className="mb-4 text-sm text-black/50">
          Al cobrar con vales, el cajero pasa la tarjeta por el lector y el sistema la identifica por su{" "}
          <strong>BIN</strong> (los primeros 6 dígitos, que son los que dicen qué emisor la expidió). Del plástico solo
          se guardan el BIN y los últimos 4 dígitos, nunca el número completo.
        </p>
        <p className="text-sm text-black/50">
          No existe un catálogo público confiable de qué BIN pertenece a cada emisor mexicano, y adivinarlos sería peor
          que no tenerlos: una tarjeta mal clasificada se le cobraría al emisor equivocado. Por eso el sistema{" "}
          <strong>aprende</strong>: la primera vez que aparece un BIN nuevo el cajero dice de quién es, y a partir de
          ahí esas tarjetas se reconocen solas.
        </p>
      </Card>

      {sinAsignar.length > 0 ? (
        <Card>
          <h2 className="mb-1 font-semibold text-amber-800">BINs por clasificar ({sinAsignar.length})</h2>
          <p className="mb-3 text-sm text-black/50">
            Tarjetas que ya se pasaron en alguna caja pero de las que todavía no se sabe el emisor.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">BIN</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Veces vista</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Emisor</th>
                </tr>
              </thead>
              <tbody>
                {paginaSinAsignar.map((b) => (
                  <tr key={b._id} className="border-b border-black/5">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">{b.bin}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{b.veces}</td>
                    <td className="px-2 py-1.5">
                      <Select defaultValue="" onChange={(e) => asignar(b.bin, e.target.value)} className="max-w-64">
                        <option value="">Elige el emisor</option>
                        {emisores
                          .filter((e) => e.activo)
                          .map((e) => (
                            <option key={e._id} value={e._id}>
                              {e.nombre}
                            </option>
                          ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacionSinAsignar} />
        </Card>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Emisores de vales ({emisores.length})</h2>
          <div className="flex items-end gap-2">
            <FormField label="Nuevo emisor">
              <Input
                icon={Ticket}
                value={nuevoEmisor}
                onChange={(e) => setNuevoEmisor(e.target.value)}
                placeholder="Nombre del emisor"
                className="w-56"
              />
            </FormField>
            <Button onClick={crearEmisor} disabled={guardando || !nuevoEmisor.trim()}>
              {guardando ? "..." : "Agregar"}
            </Button>
          </div>
        </div>

        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : emisores.length === 0 ? (
          <EmptyState message="Todavía no hay emisores registrados." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Emisor</th>
                  <th className="px-2 py-1.5 text-xs font-medium">BINs reconocidos</th>
                </tr>
              </thead>
              <tbody>
                {paginaEmisores.map((e) => (
                  <tr key={e._id} className={`border-b border-black/5 ${!e.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <CreditCard className="h-4 w-4 text-black/30" />
                        {e.nombre}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {e.prefijosBin.length === 0 ? (
                        <span className="text-xs text-black/40">
                          Ninguno todavía — se llenan al pasar la primera tarjeta
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {e.prefijosBin.map((bin) => (
                            <span
                              key={bin}
                              className="rounded-full bg-titos-green-100 px-2 py-0.5 font-mono text-xs font-semibold text-titos-green-700"
                            >
                              {bin}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacionEmisores} />
          </>
        )}

        {asignados.length > 0 ? (
          <p className="mt-3 text-xs text-black/40">
            {asignados.length} BIN(s) ya clasificados; esas tarjetas se identifican solas en el punto de venta.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
