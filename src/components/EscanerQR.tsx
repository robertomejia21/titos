"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import jsQR from "jsqr";
import { Camera, CameraOff } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { PUNTO_ESCANEO_LABEL, type PuntoEscaneo } from "@/lib/logistica";
import type { ResultadoEscaneo } from "@/lib/trazabilidad";

// Lector de QR con la cámara de la tablet. Usa el detector nativo del navegador
// cuando existe (Chrome en Android) y jsQR en los demás (iPad/Safari). También
// acepta el código tecleado, por si la cámara no enfoca.

type Detector = { detect: (fuente: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type ConDetector = { BarcodeDetector?: new (opciones: { formats: string[] }) => Detector };

const INTERVALO_MS = 250;
/** El mismo código seguido no se vuelve a mandar en este tiempo. */
const REPETIDO_MS = 4000;

type Lectura = (ResultadoEscaneo & { en: number }) | { error: string; en: number };

export function EscanerQR({ puntos, codigoInicial, rutaFolio }: { puntos: PuntoEscaneo[]; codigoInicial?: string; rutaFolio: string }) {
  const [punto, setPunto] = useState<PuntoEscaneo>(puntos[0]);
  const [camara, setCamara] = useState(false);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const ultimo = useRef<{ codigo: string; en: number } | null>(null);
  const enviando = useRef(false);
  const puntoActual = useRef(punto);
  useEffect(() => {
    puntoActual.current = punto;
  }, [punto]);

  const enviar = useCallback(async (codigo: string) => {
    const ahora = Date.now();
    if (enviando.current) return;
    if (ultimo.current && ultimo.current.codigo === codigo && ahora - ultimo.current.en < REPETIDO_MS) return;
    ultimo.current = { codigo, en: ahora };
    enviando.current = true;
    const res = await fetch("/api/escaneos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo, punto: puntoActual.current }) }).catch(() => null);
    enviando.current = false;
    const data = res ? await res.json().catch(() => ({})) : { error: "Sin conexión" };
    const lectura: Lectura = res?.ok ? { ...data, en: ahora } : { error: data.error || "No se pudo registrar", en: ahora };
    setLecturas((prev) => [lectura, ...prev].slice(0, 20));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(res?.ok && !data.alerta ? 80 : [120, 80, 120]);
  }, []);

  useEffect(() => {
    if (codigoInicial) enviar(codigoInicial);
  }, [codigoInicial, enviar]);

  useEffect(() => {
    if (!camara) return;
    let flujo: MediaStream | null = null;
    let temporizador: ReturnType<typeof setInterval> | null = null;
    let vigente = true;
    const Nativo = (window as unknown as ConDetector).BarcodeDetector;
    const detector = Nativo ? new Nativo({ formats: ["qr_code"] }) : null;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (!vigente) return s.getTracks().forEach((t) => t.stop());
        flujo = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        temporizador = setInterval(async () => {
          const v = video.current;
          if (!v || v.readyState < 2) return;
          if (detector) {
            const [hallado] = await detector.detect(v).catch(() => []);
            if (hallado?.rawValue) enviar(hallado.rawValue);
            return;
          }
          const c = lienzo.current;
          if (!c) return;
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const imagen = ctx.getImageData(0, 0, c.width, c.height);
          const hallado = jsQR(imagen.data, imagen.width, imagen.height, { inversionAttempts: "dontInvert" });
          if (hallado?.data) enviar(hallado.data);
        }, INTERVALO_MS);
      })
      .catch(() => {
        setErrorCamara("No se pudo abrir la cámara. Da permiso a la cámara en el navegador o teclea el código.");
        setCamara(false);
      });
    if (!navigator.mediaDevices) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el navegador no tiene cámara disponible
      setErrorCamara("Este navegador no permite usar la cámara (se necesita https).");
      setCamara(false);
    }

    return () => {
      vigente = false;
      if (temporizador) clearInterval(temporizador);
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, [camara, enviar]);

  const actual = lecturas[0];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        {puntos.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Punto de escaneo">
            {puntos.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={punto === p}
                onClick={() => setPunto(p)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${punto === p ? "border-titos-green-600 bg-titos-green-600 text-white" : "border-black/10 text-black/60"}`}
              >
                {PUNTO_ESCANEO_LABEL[p]}
              </button>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm font-semibold text-titos-green-900">{PUNTO_ESCANEO_LABEL[punto]}</p>
        )}

        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={video} className={`h-full w-full object-cover ${camara ? "" : "hidden"}`} muted playsInline />
          {camara ? <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" aria-hidden="true" /> : null}
          {!camara ? (
            <div className="grid h-full place-items-center p-6 text-center text-white/70">
              <div>
                <Camera className="mx-auto h-10 w-10" aria-hidden="true" />
                <p className="mt-2 text-sm">Abre la cámara y apunta al QR de la caja.</p>
              </div>
            </div>
          ) : null}
          <canvas ref={lienzo} className="hidden" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setCamara((v) => !v)} variant={camara ? "ghost" : "primary"}>
            <span className="inline-flex items-center gap-1.5">
              {camara ? <CameraOff className="h-4 w-4" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
              {camara ? "Apagar cámara" : "Abrir cámara"}
            </span>
          </Button>
        </div>
        {errorCamara ? <p className="mt-2 text-sm text-amber-700">{errorCamara}</p> : null}

        <form
          className="mt-4 flex flex-wrap gap-2 border-t border-black/5 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) {
              ultimo.current = null;
              enviar(manual.trim());
              setManual("");
            }
          }}
        >
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="O teclea el código del QR" className="min-w-0 flex-1" aria-label="Código del QR" />
          <Button type="submit" variant="ghost">
            Registrar
          </Button>
        </form>
      </Card>

      <div className="space-y-3">
        {actual ? (
          "error" in actual ? (
            <Card className="border-2 border-red-500">
              <p role="alert" className="text-lg font-bold text-red-700">
                {actual.error}
              </p>
            </Card>
          ) : (
            <Card className={`border-2 ${actual.ok && !actual.alerta ? "border-titos-green-500" : actual.ok ? "border-amber-500" : "border-red-500"}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${actual.ok ? "text-titos-green-700" : "text-red-700"}`}>{actual.mensaje}</p>
              <p className="mt-1 text-2xl font-bold text-titos-green-900">
                {actual.folio}
                {actual.caja ? <span className="ml-2 text-lg text-black/60">Caja {actual.caja}</span> : null}
              </p>
              <p className="text-lg">
                Para <strong>{actual.sucursalDestino}</strong>
              </p>
              <p className="mt-1 text-sm text-black/65">{actual.contenido}</p>
              {actual.salida ? <p className="mt-1 text-sm text-black/55">Salida: {actual.salida}</p> : null}
              {actual.alerta ? (
                <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-base font-semibold ${actual.ok ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>
                  {actual.alerta}
                </p>
              ) : null}
              <p className="mt-3 text-sm text-black/60">
                {PUNTO_ESCANEO_LABEL[punto]}: {actual.avance.escaneadas} de {actual.avance.total} {actual.avance.total === 1 ? "bulto" : "bultos"} del folio
              </p>
              {/* Una tienda que recibió la caja por error no puede abrir el folio de otra. */}
              {actual.ok ? (
                <Link href={`${rutaFolio}${actual.pedidoId}`} className="mt-2 inline-block text-sm font-medium text-titos-green-700 underline">
                  Ver el folio
                </Link>
              ) : null}
            </Card>
          )
        ) : (
          <Card>
            <p className="text-sm text-black/50">Todavía no hay lecturas en esta sesión.</p>
          </Card>
        )}

        {lecturas.length > 1 ? (
          <Card>
            <p className="mb-2 text-sm font-semibold text-titos-green-900">Lecturas anteriores</p>
            <ul className="divide-y divide-black/5 text-sm">
              {lecturas.slice(1).map((l) => (
                <li key={l.en} className="py-1.5">
                  {"error" in l ? (
                    <span className="text-red-600">{l.error}</span>
                  ) : (
                    <span className={l.ok ? (l.alerta ? "text-amber-700" : "text-black/70") : "text-red-600"}>
                      {l.folio}
                      {l.caja ? ` · caja ${l.caja}` : ""} → {l.sucursalDestino}
                      {l.alerta ? ` · ${l.alerta}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
