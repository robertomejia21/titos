"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";

type Evidencia = { _id: string; productoId: string | null; nombreProducto: string; nota: string; bytes: number };

/** Lado mayor de la foto ya comprimida: suficiente para ver el daño en un WhatsApp. */
const LADO_MAXIMO = 1280;

/**
 * Comprime la foto en el navegador antes de subirla: una foto de celular pesa
 * 3-5 MB y con esto queda en ~200 KB, que es lo que aguanta la subida y lo que
 * se manda por WhatsApp.
 */
async function comprimir(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la foto"));
      img.src = url;
    });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(imagen.width * escala);
    canvas.height = Math.round(imagen.height * escala);
    canvas.getContext("2d")!.drawImage(imagen, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fotos de evidencia de la recepción (mercancía dañada, quemada por frío, de
 * otro tamaño). Se toman con el celular o la tablet del andén y salen en el
 * aviso a Compras y al proveedor al confirmar la recepción.
 */
export function EvidenciasRecepcion({
  ordenId,
  editable,
  productos,
}: {
  ordenId: string;
  editable: boolean;
  productos: { productoId: string; nombreProducto: string }[];
}) {
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [productoId, setProductoId] = useState("");
  const [nota, setNota] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/ordenes-compra/${ordenId}/evidencias`);
    if (res.ok) setEvidencias(await res.json());
  }, [ordenId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de las fotos
    cargar();
  }, [cargar]);

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setSubiendo(true);
    setError(null);
    try {
      for (const archivo of Array.from(archivos)) {
        const imagen = await comprimir(archivo);
        const res = await fetch(`/api/ordenes-compra/${ordenId}/evidencias`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagen, productoId: productoId || undefined, nota }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo subir la foto");
      }
      setNota("");
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (archivoRef.current) archivoRef.current.value = "";
    }
  }

  async function borrar(id: string) {
    const res = await fetch(`/api/ordenes-compra/${ordenId}/evidencias/${id}`, { method: "DELETE" });
    if (res.ok) setEvidencias((prev) => prev.filter((e) => e._id !== id));
  }

  if (!editable && evidencias.length === 0) return null;

  return (
    <section className="mt-4 rounded border border-black/20 p-3">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Camera className="h-4 w-4" aria-hidden="true" /> Fotos de evidencia ({evidencias.length})
      </h3>
      {editable ? (
        <>
          <p className="mt-1 text-sm text-black/60">Toma foto de lo que se rechaza o llega dañado. Se mandan a Compras y al proveedor al confirmar la recepción.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-56" aria-label="Producto de la foto">
              <option value="">— Producto (opcional) —</option>
              {productos.map((p) => (
                <option key={p.productoId} value={p.productoId}>
                  {p.nombreProducto}
                </option>
              ))}
            </Select>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. quemado por frío, verde" className="min-w-0 flex-1" aria-label="Nota de la foto" maxLength={500} />
            <input ref={archivoRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => subir(e.target.files)} />
            <Button type="button" variant="ghost" onClick={() => archivoRef.current?.click()} disabled={subiendo}>
              {subiendo ? "Subiendo..." : "Tomar o subir foto"}
            </Button>
          </div>
        </>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {evidencias.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {evidencias.map((e) => (
            <li key={e._id} className="relative overflow-hidden rounded-lg border border-black/10">
              <a href={`/api/ordenes-compra/${ordenId}/evidencias/${e._id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por la API, no optimizable */}
                <img src={`/api/ordenes-compra/${ordenId}/evidencias/${e._id}`} alt={e.nota || e.nombreProducto || "Evidencia"} className="h-28 w-full object-cover" />
              </a>
              <p className="truncate px-2 py-1 text-xs text-black/60" title={[e.nombreProducto, e.nota].filter(Boolean).join(" — ")}>
                {[e.nombreProducto, e.nota].filter(Boolean).join(" — ") || "Sin nota"}
              </p>
              {editable ? (
                <button onClick={() => borrar(e._id)} className="absolute right-1 top-1 rounded bg-white/90 p-1 text-red-600" aria-label="Quitar foto">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
