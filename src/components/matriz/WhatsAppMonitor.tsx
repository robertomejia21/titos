"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Search, RefreshCw, Wifi, WifiOff, ArrowLeft, Send } from "lucide-react";
import { Button, Card, Input, EmptyState } from "@/components/ui";
import { sendMessage } from "./whatsappMonitorActions";

type Contacto = {
  chatId: string;
  nombre: string;
  ultimoMensaje: number;
};

type Mensaje = {
  id: string;
  timestamp: number;
  tipo: "incoming" | "outgoing";
  tipoMensaje: string;
  texto: string;
  remitente: string;
};

const formatFecha = (ts: number) => {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
};

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function WhatsAppMonitor() {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [estado, setEstado] = useState("cargando");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<Contacto | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [textoRespuesta, setTextoRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp-monitor");
      const data = await res.json();
      if (data.error && !data.contactos?.length) {
        setError(data.error);
      }
      setContactos(data.contactos ?? []);
      setEstado(data.estado ?? "error");
    } catch {
      setError("No se pudo conectar con el servidor");
    }
    setCargando(false);
  }

  async function cargarHistorial(contacto: Contacto) {
    setSeleccionado(contacto);
    setCargandoMensajes(true);
    try {
      const res = await fetch(
        `/api/whatsapp-monitor/historial?chatId=${encodeURIComponent(contacto.chatId)}`
      );
      const data = await res.json();
      setMensajes(data.mensajes ?? []);
    } catch {
      setMensajes([]);
    }
    setCargandoMensajes(false);
  }

  async function enviarRespuesta() {
    if (!seleccionado || !textoRespuesta.trim()) return;
    setEnviando(true);
    try {
      const telefono = seleccionado.chatId.replace("@c.us", "");
      await sendMessage(telefono, textoRespuesta.trim());
      setTextoRespuesta("");
      await cargarHistorial(seleccionado);
    } catch {
      // silently fail, user sees the message didn't appear
    }
    setEnviando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  const contactosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return contactos;
    const q = normalizar(busqueda);
    return contactos.filter(
      (c) => normalizar(c.nombre).includes(q) || c.chatId.includes(q)
    );
  }, [contactos, busqueda]);

  const estadoConectado = estado === "authorized";

  if (seleccionado) {
    return (
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <Button variant="ghost" onClick={() => setSeleccionado(null)}>
            <ArrowLeft className="mr-1 inline h-4 w-4" /> Volver
          </Button>
          <div className="flex-1">
            <h2 className="font-semibold text-titos-green-900">
              {seleccionado.nombre}
            </h2>
            <p className="text-xs text-black/40">
              {seleccionado.chatId.replace("@c.us", "")}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => cargarHistorial(seleccionado)}
            disabled={cargandoMensajes}
          >
            <RefreshCw
              className={`h-4 w-4 ${cargandoMensajes ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-lg border border-black/5 bg-black/[0.02] p-4">
          {cargandoMensajes ? (
            <p className="text-center text-sm text-black/50">
              Cargando mensajes…
            </p>
          ) : mensajes.length === 0 ? (
            <p className="text-center text-sm text-black/50">
              Sin mensajes recientes
            </p>
          ) : (
            [...mensajes].reverse().map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm ${
                  m.tipo === "outgoing"
                    ? "ml-auto bg-titos-green-100 text-titos-green-900"
                    : "mr-auto bg-white text-black/80 shadow-sm border border-black/5"
                }`}
              >
                {m.tipo === "incoming" && m.remitente ? (
                  <p className="mb-0.5 text-xs font-semibold text-titos-green-700">
                    {m.remitente}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">
                  {m.texto || (
                    <span className="italic text-black/40">
                      [{m.tipoMensaje}]
                    </span>
                  )}
                </p>
                <p className="mt-1 text-right text-[10px] text-black/30">
                  {formatFecha(m.timestamp)}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            value={textoRespuesta}
            onChange={(e) => setTextoRespuesta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviarRespuesta();
              }
            }}
            placeholder="Escribe un mensaje…"
            disabled={enviando}
          />
          <Button
            onClick={enviarRespuesta}
            disabled={enviando || !textoRespuesta.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-titos-green-900">
            Conversaciones de WhatsApp
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              estadoConectado
                ? "bg-titos-green-100 text-titos-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {estadoConectado ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {estadoConectado ? "Conectado" : estado === "cargando" ? "Conectando…" : "Desconectado"}
          </span>
        </div>
        <Button variant="ghost" onClick={cargar} disabled={cargando}>
          <RefreshCw
            className={`mr-1 inline h-4 w-4 ${cargando ? "animate-spin" : ""}`}
          />{" "}
          Actualizar
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mb-4">
        <Input
          icon={Search}
          type="search"
          placeholder="Buscar por nombre o número…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p className="mb-3 text-sm text-black/50">
        {cargando
          ? "Cargando conversaciones…"
          : `${contactosFiltrados.length} conversación${contactosFiltrados.length !== 1 ? "es" : ""}`}
      </p>

      {!cargando && contactosFiltrados.length === 0 ? (
        <EmptyState
          message={
            busqueda
              ? "Sin conversaciones que coincidan con la búsqueda."
              : "No hay conversaciones recientes."
          }
        />
      ) : (
        <div className="space-y-1">
          {contactosFiltrados.map((c) => (
            <button
              key={c.chatId}
              type="button"
              onClick={() => cargarHistorial(c)}
              className="flex w-full items-center gap-3 rounded-xl border border-black/5 px-4 py-3 text-left transition-colors hover:border-titos-green-500 hover:bg-titos-green-100/40"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-titos-green-100 text-titos-green-700">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-titos-green-900">
                  {c.nombre}
                </p>
                <p className="text-xs text-black/40">
                  {c.chatId.replace("@c.us", "")}
                </p>
              </div>
              <span className="shrink-0 text-xs text-black/40">
                {formatFecha(c.ultimoMensaje)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
