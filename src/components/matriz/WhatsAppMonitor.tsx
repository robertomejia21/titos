"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function formatFecha(ts: number) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  if (esHoy) return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function formatHora(ts: number) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ConversacionView({
  contacto,
  onVolver,
}: {
  contacto: Contacto;
  onVolver: () => void;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(
        `/api/whatsapp-monitor/historial?chatId=${encodeURIComponent(contacto.chatId)}`
      );
      const data = await res.json();
      setMensajes(data.mensajes ?? []);
    } catch {
      setMensajes([]);
    }
    setCargando(false);
  }, [contacto.chatId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  async function enviar() {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await sendMessage(contacto.chatId.replace("@c.us", ""), texto.trim());
      setTexto("");
      await cargar();
    } catch { /* user sees message didn't appear */ }
    setEnviando(false);
  }

  const mensajesOrdenados = useMemo(() => [...mensajes].reverse(), [mensajes]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-3 sm:gap-3 sm:px-5 sm:py-4">
        <button
          onClick={onVolver}
          className="shrink-0 rounded-lg p-1.5 text-black/40 hover:bg-titos-green-100 hover:text-titos-green-700 sm:p-2"
          aria-label="Volver a conversaciones"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-titos-green-100 text-titos-green-700 sm:h-10 sm:w-10">
          <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-titos-green-900 sm:text-base">
            {contacto.nombre}
          </p>
          <p className="truncate text-xs text-black/40">
            {contacto.chatId.replace("@c.us", "")}
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="shrink-0 rounded-lg p-1.5 text-black/40 hover:bg-titos-green-100 hover:text-titos-green-700 disabled:opacity-50 sm:p-2"
          aria-label="Actualizar"
        >
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-1.5 overflow-y-auto bg-black/[0.02] p-3 sm:space-y-2 sm:p-4"
        style={{ minHeight: 0 }}
      >
        {cargando ? (
          <p className="py-12 text-center text-sm text-black/40">Cargando…</p>
        ) : mensajesOrdenados.length === 0 ? (
          <p className="py-12 text-center text-sm text-black/40">Sin mensajes recientes</p>
        ) : (
          mensajesOrdenados.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.tipo === "outgoing" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[70%] sm:px-3.5 ${
                  m.tipo === "outgoing"
                    ? "rounded-br-md bg-titos-green-600 text-white"
                    : "rounded-bl-md bg-white text-black/80 shadow-sm ring-1 ring-black/5"
                }`}
              >
                {m.tipo === "incoming" && m.remitente ? (
                  <p className="mb-0.5 text-xs font-semibold text-titos-green-700">
                    {m.remitente}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {m.texto || (
                    <span className={m.tipo === "outgoing" ? "italic text-white/60" : "italic text-black/40"}>
                      [{m.tipoMensaje}]
                    </span>
                  )}
                </p>
                <p className={`mt-1 text-right text-[10px] ${m.tipo === "outgoing" ? "text-white/50" : "text-black/30"}`}>
                  {formatHora(m.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Compose */}
      <div className="border-t border-black/5 p-3 sm:p-4">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribe un mensaje…"
              disabled={enviando}
            />
          </div>
          <Button onClick={enviar} disabled={enviando || !texto.trim()} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WhatsAppMonitor() {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [estado, setEstado] = useState("cargando");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<Contacto | null>(null);

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp-monitor");
      const data = await res.json();
      if (data.error && !data.contactos?.length) setError(data.error);
      setContactos(data.contactos ?? []);
      setEstado(data.estado ?? "error");
    } catch {
      setError("No se pudo conectar con el servidor");
    }
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

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
      <Card className="flex flex-col overflow-hidden p-0 sm:h-[calc(100vh-12rem)]">
        <ConversacionView
          contacto={seleccionado}
          onVolver={() => setSeleccionado(null)}
        />
      </Card>
    );
  }

  return (
    <Card>
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-base font-semibold text-titos-green-900 sm:text-lg">
            Conversaciones
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              estadoConectado
                ? "bg-titos-green-100 text-titos-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {estadoConectado ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {estadoConectado ? "Conectado" : estado === "cargando" ? "Conectando…" : "Desconectado"}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={cargar} disabled={cargando}>
          <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Search */}
      <div className="mb-3">
        <Input
          icon={Search}
          type="search"
          placeholder="Buscar por nombre o número…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p className="mb-3 text-xs text-black/40 sm:text-sm">
        {cargando
          ? "Cargando…"
          : `${contactosFiltrados.length} conversación${contactosFiltrados.length !== 1 ? "es" : ""}`}
      </p>

      {!cargando && contactosFiltrados.length === 0 ? (
        <EmptyState
          message={busqueda ? "Sin resultados para esta búsqueda." : "No hay conversaciones recientes."}
        />
      ) : (
        <div className="space-y-1">
          {contactosFiltrados.map((c) => (
            <button
              key={c.chatId}
              type="button"
              onClick={() => setSeleccionado(c)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-titos-green-100/40 active:bg-titos-green-100/60 sm:px-4 sm:py-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-titos-green-100 text-titos-green-700 sm:h-10 sm:w-10">
                <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-titos-green-900">
                  {c.nombre}
                </p>
                <p className="truncate text-xs text-black/40">
                  {c.chatId.replace("@c.us", "")}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-black/30 sm:text-xs">
                {formatFecha(c.ultimoMensaje)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
