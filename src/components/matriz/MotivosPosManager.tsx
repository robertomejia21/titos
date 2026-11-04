"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, ListChecks, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button, Card, EmptyState, Input } from "@/components/ui";
import {
  LARGO_MAXIMO_MOTIVO,
  MOTIVOS_SUGERIDOS,
  TIPOS_MOTIVO_POS,
  TIPO_MOTIVO_LABEL,
  type MotivoPos,
  type TipoMotivoPos,
} from "@/lib/motivosPos";
import { SkeletonTabla } from "@/components/Skeleton";

const AYUDA: Record<TipoMotivoPos, string> = {
  cancelacion:
    "Se ofrecen al quitar un producto del carrito, al cancelar una venta en curso y al cancelar una venta ya cobrada.",
  devolucion: "Se ofrecen al capturar una devolución en el mostrador de matriz o de una sucursal.",
};

/**
 * Catálogo de motivos con los que los puntos de venta justifican cancelaciones y
 * devoluciones. Tenerlos predefinidos es lo que permite después agrupar la
 * bitácora por motivo, en vez de leer textos escritos a mano en cada sucursal.
 */
export function MotivosPosManager() {
  const [motivos, setMotivos] = useState<MotivoPos[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevos, setNuevos] = useState<Record<TipoMotivoPos, string>>({ cancelacion: "", devolucion: "" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargado = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/motivos-pos?incluirInactivos=1");
    setCargando(false);
    if (!res.ok) return;
    setMotivos(await res.json());
  }, []);

  useEffect(() => {
    if (cargado.current) return;
    cargado.current = true;
    cargar();
  }, [cargar]);

  async function pedir(url: string, init: RequestInit, marca: string) {
    setError(null);
    setOcupado(marca);
    const res = await fetch(url, init);
    setOcupado(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el motivo");
      return false;
    }
    await cargar();
    return true;
  }

  async function agregar(tipo: TipoMotivoPos, texto: string) {
    const limpio = texto.trim();
    if (!limpio) return;
    const ok = await pedir(
      "/api/motivos-pos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, texto: limpio }),
      },
      `nuevo:${tipo}`
    );
    if (ok) setNuevos((prev) => ({ ...prev, [tipo]: "" }));
  }

  function alternarActivo(motivo: MotivoPos) {
    return pedir(
      `/api/motivos-pos/${motivo._id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !motivo.activo }),
      },
      `activo:${motivo._id}`
    );
  }

  function eliminar(motivo: MotivoPos) {
    return pedir(`/api/motivos-pos/${motivo._id}`, { method: "DELETE" }, `borrar:${motivo._id}`);
  }

  /** Da de alta de un jalón los motivos típicos que todavía no estén cargados. */
  async function cargarSugeridos(tipo: TipoMotivoPos) {
    const yaEstan = new Set(motivos.filter((m) => m.tipo === tipo).map((m) => m.texto.toLowerCase()));
    const faltantes = MOTIVOS_SUGERIDOS[tipo].filter((texto) => !yaEstan.has(texto.toLowerCase()));
    if (faltantes.length === 0) return;

    setError(null);
    setOcupado(`sugeridos:${tipo}`);
    for (const texto of faltantes) {
      await fetch("/api/motivos-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, texto }),
      });
    }
    setOcupado(null);
    await cargar();
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
        <ListChecks className="h-4.5 w-4.5 text-titos-green-700" />
        Motivos de cancelación y devolución
      </h2>
      <p className="mb-4 text-sm text-black/50">
        Los cajeros eligen uno de estos motivos en los puntos de venta de matriz y de las sucursales, en vez de
        escribirlo a mano. Siempre les queda la opción de capturar &ldquo;Otro&rdquo; cuando el caso no esté en la
        lista.
      </p>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {cargando ? (
        <SkeletonTabla />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {TIPOS_MOTIVO_POS.map((tipo) => {
            const delTipo = motivos.filter((m) => m.tipo === tipo);
            return (
              <div key={tipo} className="rounded-xl border border-black/10 p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-titos-green-900">{TIPO_MOTIVO_LABEL[tipo]}</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cargarSugeridos(tipo)}
                    disabled={ocupado === `sugeridos:${tipo}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5" />
                      {ocupado === `sugeridos:${tipo}` ? "Cargando..." : "Cargar sugeridos"}
                    </span>
                  </Button>
                </div>
                <p className="mb-3 text-xs text-black/45">{AYUDA[tipo]}</p>

                {delTipo.length === 0 ? (
                  <EmptyState message="Todavía no hay motivos. Agrega los tuyos o carga los sugeridos." />
                ) : (
                  <ul className="mb-3 space-y-1.5">
                    {delTipo.map((motivo) => (
                      <li
                        key={motivo._id}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                          motivo.activo ? "border-black/10 bg-white" : "border-dashed border-black/15 bg-black/2"
                        }`}
                      >
                        <span className={motivo.activo ? "text-black/80" : "text-black/40 line-through"}>
                          {motivo.texto}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title={motivo.activo ? "Dejar de ofrecerlo" : "Volver a ofrecerlo"}
                            onClick={() => alternarActivo(motivo)}
                            disabled={ocupado === `activo:${motivo._id}`}
                            className="rounded-md p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 disabled:opacity-40"
                          >
                            {motivo.activo ? <Ban className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={() => eliminar(motivo)}
                            disabled={ocupado === `borrar:${motivo._id}`}
                            className="rounded-md p-1.5 text-black/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2">
                  <Input
                    maxLength={LARGO_MAXIMO_MOTIVO}
                    value={nuevos[tipo]}
                    onChange={(e) => setNuevos((prev) => ({ ...prev, [tipo]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        agregar(tipo, nuevos[tipo]);
                      }
                    }}
                    placeholder={`Nuevo motivo de ${TIPO_MOTIVO_LABEL[tipo].toLowerCase()}`}
                  />
                  <Button onClick={() => agregar(tipo, nuevos[tipo])} disabled={!nuevos[tipo].trim() || !!ocupado}>
                    <span className="flex items-center gap-1.5">
                      {ocupado === `nuevo:${tipo}` ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      Agregar
                    </span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
