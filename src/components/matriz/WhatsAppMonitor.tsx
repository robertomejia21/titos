"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Search, RefreshCw, Wifi, WifiOff, ArrowLeft, Send,
  Settings, QrCode, Loader2, User,
} from "lucide-react";
import { Button, Card, Input, EmptyState, Modal } from "@/components/ui";
import { sendMessage } from "./whatsappMonitorActions";

type Contacto = {
  chatId: string;
  /** Nombre de la agenda del teléfono vinculado; si no está guardado, el del perfil o el número. */
  nombre: string;
  numero: string;
  /** El que la persona se puso en WhatsApp; se muestra sólo si difiere del de la agenda. */
  nombrePerfil: string;
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

// Traduce las fallas técnicas de Green API a algo sobre lo que se pueda actuar:
// el código HTTP en pantalla no le dice nada a quien opera el sistema.
function mensajeConexion(error: string): string {
  if (!error) return "";
  if (/\b(401|403)\b|no está configurada/i.test(error)) {
    return "No se pudieron validar las credenciales de Green API. Revísalas en la configuración del proyecto y vuelve a desplegar.";
  }
  // Bloqueada, suspendida o en reposo ya vienen redactadas desde el servidor.
  if (/bloquead|suspendid|reposo/i.test(error)) return error;
  return "No se pudo consultar el estado de WhatsApp. Vuelve a intentarlo en un momento.";
}

const AVISO = "rounded-lg bg-titos-orange-100 px-3 py-2 text-xs text-titos-orange-700";

/* ── Avatar ── */

function iniciales(nombre: string) {
  const palabras = nombre.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p));
  return palabras.slice(0, 2).map((p) => [...p][0].toUpperCase()).join("");
}

// La foto llega por /api/whatsapp-monitor/avatar; mientras carga —o si el
// contacto no tiene foto, que es lo normal cuando la restringe por privacidad—
// se ve debajo el respaldo: iniciales del nombre de la agenda, o una silueta
// cuando sólo se conoce el número.
function Avatar({ contacto }: { contacto: Contacto }) {
  const [sinFoto, setSinFoto] = useState(false);
  const letras = iniciales(contacto.nombre);

  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-titos-green-100 text-titos-green-700 sm:h-10 sm:w-10">
      {/* aria-hidden: el nombre ya lo dice el renglón, las iniciales sólo
          ensuciarían el texto que lee un lector de pantalla. */}
      {letras ? (
        <span aria-hidden className="text-sm font-semibold">{letras}</span>
      ) : (
        <User aria-hidden className="h-4 w-4 sm:h-5 sm:w-5" />
      )}
      {sinFoto ? null : (
        <Image
          src={`/api/whatsapp-monitor/avatar?chatId=${encodeURIComponent(contacto.chatId)}`}
          alt=""
          width={40}
          height={40}
          unoptimized
          onError={() => setSinFoto(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/* ── QR Modal ── */

function QRModal({ onClose, onConectado }: { onClose: () => void; onConectado: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const pedirQR = useCallback(async () => {
    setCargando(true);
    setError(null);
    const res = await fetch("/api/whatsapp/qr");
    setCargando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      setError(data.error || "No se pudo obtener el código QR");
      return;
    }
    setQr(data.qr);
  }, []);

  // El QR de Green API caduca a los ~20s: se renueva solo mientras el modal
  // esté abierto, si no da tiempo de escanearlo.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del QR al abrir el modal
    pedirQR();
    const t = setInterval(pedirQR, 15000);
    return () => clearInterval(t);
  }, [pedirQR]);

  useEffect(() => {
    const intervalo = setInterval(async () => {
      const res = await fetch("/api/whatsapp/estado");
      if (!res.ok) return;
      const data = await res.json();
      if (data.estado === "open") { clearInterval(intervalo); onConectado(); }
    }, 3000);
    return () => clearInterval(intervalo);
  }, [onConectado]);

  return (
    <Modal open onClose={onClose} title="Vincular WhatsApp" icon={QrCode}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <p className="text-sm text-black/60">
          Abre WhatsApp en el teléfono →{" "}
          <span className="font-medium">Dispositivos vinculados → Vincular un dispositivo</span> y escanea este código.
        </p>
        {cargando && !qr ? (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10">
            <Loader2 className="h-8 w-8 animate-spin text-titos-green-600" />
          </div>
        ) : error ? (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-titos-orange-500/40 bg-titos-orange-100 p-4">
            <p className="text-sm text-titos-orange-700">{mensajeConexion(error)}</p>
          </div>
        ) : qr ? (
          <Image src={qr} alt="Código QR de WhatsApp" width={256} height={256} className="rounded-xl border border-black/10" unoptimized />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10 p-4 text-sm text-black/40">
            No se recibió un código QR. La instancia podría ya estar conectada.
          </div>
        )}
        <Button type="button" variant="ghost" onClick={pedirQR} disabled={cargando}>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" /> Generar nuevo código
          </span>
        </Button>
      </div>
    </Modal>
  );
}

/* ── Settings Panel (inline, toggled by cog icon) ── */

function SettingsPanel({
  estadoWA,
  errorWA,
  cargandoEstado,
  onRefresh,
}: {
  estadoWA: string;
  errorWA: string;
  cargandoEstado: boolean;
  onRefresh: () => void;
}) {
  const [mostrarQR, setMostrarQR] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmandoDesconectar, setConfirmandoDesconectar] = useState(false);
  const conectado = estadoWA === "open";

  async function desconectar() {
    setDesconectando(true);
    const res = await fetch("/api/whatsapp/desconectar", { method: "POST" });
    setDesconectando(false);
    setConfirmandoDesconectar(false);
    if (res.ok) onRefresh();
  }

  return (
    <div className="rounded-xl border border-black/5 bg-black/[0.02] p-4">
      <h3 className="mb-2 text-sm font-semibold text-titos-green-900">Conexión de WhatsApp (Green API)</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            conectado ? "bg-titos-green-100 text-titos-green-700" : "bg-titos-orange-100 text-titos-orange-700"
          }`}
        >
          {conectado ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {cargandoEstado ? "Consultando…" : conectado ? "Conectado" : "Sin vincular"}
        </span>

        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={cargandoEstado}>
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${cargandoEstado ? "animate-spin" : ""}`} />
          Actualizar
        </Button>

        {!conectado ? (
          <Button size="sm" onClick={() => setMostrarQR(true)}>
            <QrCode className="mr-1 inline h-3.5 w-3.5" /> Vincular QR
          </Button>
        ) : confirmandoDesconectar ? (
          <>
            <span className="text-xs text-black/60">¿Desconectar?</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirmandoDesconectar(false)}>Cancelar</Button>
            <Button variant="danger" size="sm" onClick={desconectar} disabled={desconectando}>
              {desconectando ? "…" : "Sí"}
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmandoDesconectar(true)}>Desconectar</Button>
        )}
      </div>

      {errorWA ? (
        <p className={`mt-3 break-words ${AVISO}`}>{mensajeConexion(errorWA)}</p>
      ) : !conectado && !cargandoEstado ? (
        <p className={`mt-3 ${AVISO}`}>
          WhatsApp todavía no está vinculado. Pulsa <strong>Vincular QR</strong> y escanea el código desde el
          teléfono que usará el sistema para enviar mensajes.
        </p>
      ) : null}

      {mostrarQR ? (
        <QRModal
          onClose={() => { setMostrarQR(false); onRefresh(); }}
          onConectado={() => { setMostrarQR(false); onRefresh(); }}
        />
      ) : null}
    </div>
  );
}

/* ── Conversation View ── */

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del historial
    cargar();
  }, [cargar]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  async function enviar() {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await sendMessage(contacto.numero, texto.trim());
      setTexto("");
      await cargar();
    } catch { /* user sees message didn't appear */ }
    setEnviando(false);
  }

  const mensajesOrdenados = useMemo(() => [...mensajes].reverse(), [mensajes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-3 sm:gap-3 sm:px-5 sm:py-4">
        <button onClick={onVolver} className="shrink-0 rounded-lg p-1.5 text-black/40 hover:bg-titos-green-100 hover:text-titos-green-700 sm:p-2" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar contacto={contacto} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-titos-green-900 sm:text-base">{contacto.nombre}</p>
          <p className="truncate text-xs text-black/40">
            {contacto.numero}
            {/* Como en WhatsApp: el nombre del perfil se antepone con ~ cuando
                no coincide con el guardado en la agenda. */}
            {contacto.nombrePerfil && contacto.nombrePerfil !== contacto.nombre
              ? ` · ~${contacto.nombrePerfil}`
              : ""}
          </p>
        </div>
        <button onClick={cargar} disabled={cargando} className="shrink-0 rounded-lg p-1.5 text-black/40 hover:bg-titos-green-100 hover:text-titos-green-700 disabled:opacity-50 sm:p-2" aria-label="Actualizar">
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto bg-black/[0.02] p-3 sm:space-y-2 sm:p-4" style={{ minHeight: 0 }}>
        {cargando ? (
          <p className="py-12 text-center text-sm text-black/40">Cargando…</p>
        ) : mensajesOrdenados.length === 0 ? (
          <p className="py-12 text-center text-sm text-black/40">Sin mensajes recientes</p>
        ) : (
          mensajesOrdenados.map((m) => (
            <div key={m.id} className={`flex ${m.tipo === "outgoing" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[70%] sm:px-3.5 ${
                m.tipo === "outgoing"
                  ? "rounded-br-md bg-titos-green-600 text-white"
                  : "rounded-bl-md bg-white text-black/80 shadow-sm ring-1 ring-black/5"
              }`}>
                {m.tipo === "incoming" && m.remitente ? (
                  <p className="mb-0.5 text-xs font-semibold text-titos-green-700">{m.remitente}</p>
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

      <div className="border-t border-black/5 p-3 sm:p-4">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
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

/* ── Main Monitor ── */

export function WhatsAppMonitor() {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [estado, setEstado] = useState("cargando");
  const [estadoWA, setEstadoWA] = useState("close");
  const [errorWA, setErrorWA] = useState("");
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<Contacto | null>(null);
  const [mostrarSettings, setMostrarSettings] = useState(false);

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

  const cargarEstadoWA = useCallback(async () => {
    setCargandoEstado(true);
    try {
      const res = await fetch("/api/whatsapp/estado");
      const data = await res.json().catch(() => ({}));
      setEstadoWA(data.estado ?? "close");
      setErrorWA(data.error ?? "");
    } catch {
      setErrorWA("No se pudo consultar el estado de WhatsApp");
    }
    setCargandoEstado(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del monitor
    cargar();
    cargarEstadoWA();
  }, [cargarEstadoWA]);

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
        <ConversacionView contacto={seleccionado} onVolver={() => setSeleccionado(null)} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-base font-semibold text-titos-green-900 sm:text-lg">Conversaciones</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                estadoConectado ? "bg-titos-green-100 text-titos-green-700" : "bg-titos-orange-100 text-titos-orange-700"
              }`}
            >
              {estadoConectado ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {estadoConectado ? "Conectado" : estado === "cargando" ? "Conectando…" : "Sin vincular"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={cargar} disabled={cargando}>
              <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <button
              onClick={() => setMostrarSettings((v) => !v)}
              className={`rounded-lg p-2 transition-colors ${
                mostrarSettings
                  ? "bg-titos-green-100 text-titos-green-700"
                  : "text-black/40 hover:bg-black/5 hover:text-black/60"
              }`}
              aria-label="Configuración de WhatsApp"
            >
              <Settings className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {mostrarSettings ? (
          <div className="mb-4">
            <SettingsPanel
              estadoWA={estadoWA}
              errorWA={errorWA}
              cargandoEstado={cargandoEstado}
              onRefresh={() => { cargarEstadoWA(); cargar(); }}
            />
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-lg bg-titos-orange-100 px-3 py-2.5 text-sm text-titos-orange-700">
            {mensajeConexion(error)}
          </div>
        ) : null}

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
            message={
              busqueda
                ? "Sin resultados para esta búsqueda."
                : estadoConectado
                  ? "No hay conversaciones recientes."
                  : "Vincula WhatsApp desde el engrane para ver aquí las conversaciones."
            }
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
                <Avatar contacto={c} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-titos-green-900">{c.nombre}</p>
                  <p className="truncate text-xs text-black/40">{c.numero}</p>
                </div>
                <span className="shrink-0 text-[11px] text-black/30 sm:text-xs">{formatFecha(c.ultimoMensaje)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
