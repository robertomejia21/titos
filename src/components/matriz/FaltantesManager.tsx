"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";

type Datos = {
  fecha: string;
  porProveedor: {
    proveedorId: string;
    nombre: string;
    whatsapp: string;
    renglones: { folio: string; producto: string; ordenado: number; recibido: number; rechazado: number; motivo: string }[];
    mensaje: string;
  }[];
  bajoMinimo: { nombre: string; existencia: string; minimo: string }[];
  necesidadesPendientes: number;
  perecederos: { nombre: string; estado: string; recomendacion: string }[];
  resumenInterno: string;
  envio: { enviadoEn: string; origen: string; mensajesEnviados: number; mensajesFallidos: number; errores: string[] } | null;
};

const fmt = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });

export function FaltantesManager() {
  const zona = useZonaHoraria();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/operacion/faltantes");
    if (res.ok) setDatos(await res.json());
    else setMensaje({ tipo: "error", texto: "No se pudo armar la lista" });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
    cargar();
  }, [cargar]);

  async function enviar() {
    setEnviando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/faltantes", { method: "POST" });
    setEnviando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMensaje({ tipo: "error", texto: data.error || "No se pudo enviar" });
    setMensaje(
      data.enviado
        ? { tipo: "ok", texto: `Enviado: ${data.mensajesEnviados} mensaje(s)${data.mensajesFallidos ? `, ${data.mensajesFallidos} fallaron` : ""}.` }
        : { tipo: "error", texto: data.motivo || data.errores?.join(" · ") || "No se envió" }
    );
    cargar();
  }

  if (!datos) return <p className="text-sm text-black/50">{mensaje?.texto ?? "Cargando..."}</p>;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-titos-green-900">Lista del {datos.fecha}</p>
            <p className="text-sm text-black/50">
              {datos.envio
                ? `Enviada el ${formatFechaHora(datos.envio.enviadoEn, zona)} (${datos.envio.origen === "cron" ? "automático" : "manual"}): ${datos.envio.mensajesEnviados} mensaje(s).`
                : "Todavía no se envía hoy. Se manda sola a la hora configurada en "}
              {!datos.envio ? (
                <Link href="/matriz/reglas-surtido" className="font-medium text-titos-green-700 underline">
                  Reglas de surtido
                </Link>
              ) : null}
            </p>
          </div>
          <Button onClick={enviar} disabled={enviando}>
            <span className="inline-flex items-center gap-1.5">
              <Send className="h-4 w-4" aria-hidden="true" /> {enviando ? "Enviando..." : datos.envio ? "Reenviar ahora" : "Enviar ahora"}
            </span>
          </Button>
        </div>
        {mensaje ? (
          <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`mt-2 text-sm ${mensaje.tipo === "error" ? "text-red-600" : "text-titos-green-700"}`}>
            {mensaje.texto}
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-semibold text-titos-green-900">Para cada proveedor</h2>
          {datos.porProveedor.length === 0 ? (
            <EmptyState message="Todas las recepciones de hoy llegaron completas y sin rechazos." />
          ) : (
            datos.porProveedor.map((p) => (
              <Card key={p.proveedorId} className="p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{p.nombre}</p>
                  <span className={`text-xs ${p.whatsapp ? "text-black/50" : "font-medium text-amber-700"}`}>{p.whatsapp ? `WhatsApp ${p.whatsapp}` : "Sin WhatsApp: captúralo en Proveedores"}</span>
                </div>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-xs text-black/50">
                      <th className="py-1 font-medium">Producto</th>
                      <th className="py-1 text-right font-medium">Pedido</th>
                      <th className="py-1 text-right font-medium">Recibido</th>
                      <th className="py-1 text-right font-medium">Regresado</th>
                      <th className="py-1 pl-2 font-medium">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.renglones.map((r, i) => (
                      <tr key={i} className="border-b border-black/5">
                        <td className="py-1">
                          {r.producto} <span className="text-xs text-black/40">{r.folio}</span>
                        </td>
                        <td className="py-1 text-right">{fmt(r.ordenado)}</td>
                        <td className="py-1 text-right font-semibold">{fmt(r.recibido)}</td>
                        <td className="py-1 text-right">{r.rechazado ? fmt(r.rechazado) : "—"}</td>
                        <td className="py-1 pl-2 text-xs text-black/60">{r.motivo || (r.recibido < r.ordenado ? "Faltante" : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <h2 className="font-semibold text-titos-green-900">Resumen para Compras y almacén</h2>
          <Card className="p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm text-black/80">{datos.resumenInterno}</pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
