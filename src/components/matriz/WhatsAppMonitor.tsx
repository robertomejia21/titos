"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  MessageCircle, Search, RefreshCw, Wifi, WifiOff, ArrowLeft, Send,
  Settings, QrCode, Loader2, User,
} from "lucide-react";
import { Button, Card, Input, Modal } from "@/components/ui";
import { sendMessage } from "./whatsappMonitorActions";

type Contacto = {
  chatId: string;
  /** Nombre de la agenda del teléfono vinculado; si no está guardado, el del perfil o el número. */
  nombre: string;
  numero: string;
  /** El que la persona se puso en WhatsApp; se muestra sólo si difiere del de la agenda. */
  nombrePerfil: string;
  ultimoMensaje: number;
  ultimoTexto: string;
};

type Mensaje = {
  id: string;
  timestamp: number;
  tipo: "incoming" | "outgoing";
  tipoMensaje: string;
  texto: string;
  remitente: string;
};

// El chat abierto se recarga solo para no tener que picarle a Actualizar. Cada
// recarga es una llamada a Green API: súbelos si el consumo de la cuenta importa
// más que ver el mensaje al instante.
const REFRESCO_CHAT_MS = 20_000;
// La lista también, para que un número que escribe por primera vez aparezca
// solo. La agenda va en caché en el servidor, así que cada sondeo son dos
// consultas de mensajes, no una por contacto.
const REFRESCO_LISTA_MS = 30_000;

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
// El anillo de foco va aquí una sola vez: todos los controles de esta pantalla
// lo comparten, así ninguno se queda invisible para quien navega con teclado.
const FOCO = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titos-green-600";
const BOTON_ICONO = `grid h-11 w-11 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-50 ${FOCO}`;
// Los botones compactos de la app miden 24px de alto, que en un teléfono es un
// blanco difícil de atinar: aquí se llevan al mínimo táctil de 44px.
const ACCION = `min-h-11 ${FOCO}`;

/* ── Avatar ── */

function iniciales(nombre: string) {
  const palabras = nombre.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p));
  return palabras.slice(0, 2).map((p) => [...p][0].toUpperCase()).join("");
}

// La foto llega por /api/whatsapp-monitor/avatar; mientras carga (o si el
// contacto no tiene foto, que es lo normal cuando la restringe por privacidad)
// se ve debajo el respaldo: iniciales del nombre de la agenda, o una silueta
// cuando sólo se conoce el número.
function Avatar({ contacto }: { contacto: Contacto }) {
  const [sinFoto, setSinFoto] = useState(false);
  const letras = iniciales(contacto.nombre);

  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-titos-green-100 text-titos-green-700">
      {/* aria-hidden: el nombre ya lo dice el renglón, las iniciales sólo
          ensuciarían el texto que lee un lector de pantalla. */}
      {letras ? (
        <span aria-hidden className="text-sm font-semibold">{letras}</span>
      ) : (
        <User aria-hidden className="h-5 w-5" />
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

/* ── Estados de panel ── */

// Mismo lenguaje que el EmptyState de la app (caja punteada, fondo tenue), pero
// centrado en el alto del panel, que es donde vive: una columna vacía entera,
// no un hueco debajo de una tabla.
function PanelAviso({
  titulo,
  detalle,
  accion,
}: {
  titulo: string;
  detalle: string;
  accion?: { texto: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-dashed border-black/10 bg-black/[0.02] p-8 text-center">
        <MessageCircle aria-hidden className="mx-auto mb-3 h-8 w-8 text-titos-green-600" />
        <p className="text-sm font-semibold text-titos-green-900">{titulo}</p>
        <p className="mt-1.5 text-sm text-black/60">{detalle}</p>
        {accion ? (
          <Button size="sm" className={`mt-4 ${ACCION}`} onClick={accion.onClick}>
            {accion.texto}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// El esqueleto ocupa el sitio exacto de los renglones que vienen, para que la
// lista no salte cuando llegan. La pulsación se apaga con prefers-reduced-motion.
function EsqueletoLista() {
  return (
    <div className="space-y-1 p-2" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-2 py-2.5 motion-reduce:animate-none">
          <span className="h-10 w-10 shrink-0 rounded-full bg-black/5" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-2/5 rounded bg-black/5" />
            <span className="block h-2.5 w-3/5 rounded bg-black/[0.04]" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EsqueletoChat() {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {[
        "w-2/5 self-start",
        "w-1/2 self-end",
        "w-1/3 self-start",
      ].map((clase, i) => (
        <div key={i} className={`flex ${i === 1 ? "justify-end" : "justify-start"}`}>
          <span className={`h-12 animate-pulse rounded-2xl bg-black/5 motion-reduce:animate-none ${clase}`} />
        </div>
      ))}
    </div>
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
          Abre WhatsApp en el teléfono y entra a{" "}
          <span className="font-medium">Dispositivos vinculados, Vincular un dispositivo</span>, luego escanea este código.
        </p>
        {cargando && !qr ? (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10">
            <Loader2 className="h-8 w-8 animate-spin text-titos-green-600 motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-titos-orange-500/40 bg-titos-orange-100 p-4">
            <p className="text-sm text-titos-orange-700">{mensajeConexion(error)}</p>
          </div>
        ) : qr ? (
          <Image src={qr} alt="Código QR para vincular WhatsApp" width={256} height={256} className="rounded-xl border border-black/10" unoptimized />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10 p-4 text-sm text-black/60">
            No se recibió un código QR. La instancia podría ya estar conectada.
          </div>
        )}
        <Button type="button" variant="ghost" className={ACCION} onClick={pedirQR} disabled={cargando}>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" /> Generar nuevo código
          </span>
        </Button>
      </div>
    </Modal>
  );
}

/* ── Panel de conexión (se abre con el engrane) ── */

function PanelConexion({
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
    <div className="border-b border-black/5 bg-black/[0.02] px-4 py-3">
      <h3 className="mb-2 text-sm font-semibold text-titos-green-900">Conexión de WhatsApp (Green API)</h3>
      <div className="flex flex-wrap items-center gap-2">
        <EstadoConexion conectado={conectado} cargando={cargandoEstado} />

        <Button variant="ghost" size="sm" className={ACCION} onClick={onRefresh} disabled={cargandoEstado}>
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${cargandoEstado ? "animate-spin motion-reduce:animate-none" : ""}`} />
          Actualizar
        </Button>

        {!conectado ? (
          <Button size="sm" className={ACCION} onClick={() => setMostrarQR(true)}>
            <QrCode className="mr-1 inline h-3.5 w-3.5" /> Vincular con QR
          </Button>
        ) : confirmandoDesconectar ? (
          <>
            <span className="text-xs text-black/60">¿Desconectar?</span>
            <Button variant="ghost" size="sm" className={ACCION} onClick={() => setConfirmandoDesconectar(false)}>Cancelar</Button>
            <Button variant="danger" size="sm" className={ACCION} onClick={desconectar} disabled={desconectando}>
              {desconectando ? "Desconectando…" : "Sí, desconectar"}
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" className={ACCION} onClick={() => setConfirmandoDesconectar(true)}>Desconectar</Button>
        )}
      </div>

      {errorWA ? (
        <p className={`mt-3 break-words ${AVISO}`}>{mensajeConexion(errorWA)}</p>
      ) : !conectado && !cargandoEstado ? (
        <p className={`mt-3 ${AVISO}`}>
          WhatsApp todavía no está vinculado. Pulsa <strong>Vincular con QR</strong> y escanea el código desde el
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

function EstadoConexion({ conectado, cargando }: { conectado: boolean; cargando: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        conectado ? "bg-titos-green-100 text-titos-green-700" : "bg-titos-orange-100 text-titos-orange-700"
      }`}
    >
      {/* El icono acompaña al texto, no lo sustituye: el estado nunca se
          comunica sólo con color. */}
      {conectado ? <Wifi aria-hidden className="h-3 w-3" /> : <WifiOff aria-hidden className="h-3 w-3" />}
      {cargando ? "Consultando…" : conectado ? "Conectado" : "Sin vincular"}
    </span>
  );
}

/* ── Conversación (panel derecho) ── */

function Conversacion({
  contacto,
  mensajes,
  cargando,
  error,
  onVolver,
  onRecargar,
}: {
  contacto: Contacto;
  mensajes: Mensaje[] | undefined;
  cargando: boolean;
  error: string;
  onVolver: () => void;
  onRecargar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatPintado = useRef("");

  const ordenados = useMemo(() => [...(mensajes ?? [])].reverse(), [mensajes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Al abrir un chat se baja hasta el último mensaje. Después sólo si ya
    // estabas hasta abajo: si subiste a leer algo viejo, el refresco automático
    // no te arrastra.
    const cambioDeChat = chatPintado.current !== contacto.chatId;
    chatPintado.current = contacto.chatId;
    const pegadoAbajo = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (cambioDeChat || pegadoAbajo) el.scrollTop = el.scrollHeight;
  }, [ordenados, contacto.chatId]);

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setErrorEnvio("");
    try {
      await sendMessage(contacto.numero, limpio);
      setTexto("");
      onRecargar();
    } catch {
      setErrorEnvio("No se pudo enviar. Revisa la conexión y vuelve a intentarlo; tu texto sigue aquí.");
    }
    setEnviando(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-black/5 px-2 py-2 sm:px-3">
        {/* La flecha sólo existe donde la lista se va de la pantalla. En
            escritorio la lista sigue a la vista, así que no hay a dónde volver. */}
        <button
          onClick={onVolver}
          className={`${BOTON_ICONO} text-black/60 hover:bg-titos-green-100 hover:text-titos-green-700 lg:hidden`}
          aria-label="Volver a la lista de conversaciones"
        >
          <ArrowLeft aria-hidden className="h-5 w-5" />
        </button>
        <Avatar contacto={contacto} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-titos-green-900 sm:text-base">{contacto.nombre}</h2>
          {/* Cuando no hay nombre, el título ya es el número: repetirlo abajo no
              dice nada, y sí importa saber que ese número no está en la agenda.
              Si sí hay nombre, se muestra el número y, como en WhatsApp, el
              nombre de perfil con ~ cuando no coincide con el de la agenda. */}
          <p className="truncate text-xs text-black/60">
            {contacto.nombre === contacto.numero
              ? "Número sin guardar en la agenda"
              : `${contacto.numero}${
                  contacto.nombrePerfil && contacto.nombrePerfil !== contacto.nombre
                    ? ` · ~${contacto.nombrePerfil}`
                    : ""
                }`}
          </p>
        </div>
        <button
          onClick={onRecargar}
          disabled={cargando}
          className={`${BOTON_ICONO} text-black/60 hover:bg-titos-green-100 hover:text-titos-green-700`}
          aria-label="Actualizar esta conversación"
        >
          <RefreshCw aria-hidden className={`h-4 w-4 ${cargando ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-black/[0.02]">
        {cargando && !mensajes ? (
          <EsqueletoChat />
        ) : error ? (
          <PanelAviso
            titulo="No se pudo leer la conversación"
            detalle={mensajeConexion(error)}
            accion={{ texto: "Reintentar", onClick: onRecargar }}
          />
        ) : ordenados.length === 0 ? (
          <PanelAviso
            titulo="Sin mensajes en el último mes"
            detalle="Green API sólo conserva los mensajes recientes. Escribe abajo para retomar la conversación."
          />
        ) : (
          // justify-end: con pocos mensajes se apoyan abajo, junto al campo de
          // escribir, como en el teléfono, en vez de flotar arriba.
          <div className="flex min-h-full flex-col justify-end space-y-1.5 p-3 sm:space-y-2 sm:p-4">
            {ordenados.map((m) => (
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
                      <span className={m.tipo === "outgoing" ? "italic text-white/90" : "italic text-black/60"}>
                        [{m.tipoMensaje}]
                      </span>
                    )}
                  </p>
                  <p className={`mt-1 text-right text-[10px] ${m.tipo === "outgoing" ? "text-white/90" : "text-black/55"}`}>
                    {formatHora(m.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-black/5 p-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="mensaje-whatsapp">Mensaje para {contacto.nombre}</label>
            <Input
              id="mensaje-whatsapp"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              placeholder="Escribe un mensaje…"
              disabled={enviando}
              autoComplete="off"
            />
          </div>
          <Button onClick={enviar} disabled={enviando || !texto.trim()} className={`h-11 w-11 shrink-0 p-0 ${FOCO}`} aria-label="Enviar mensaje">
            {enviando
              ? <Loader2 aria-hidden className="mx-auto h-4 w-4 animate-spin motion-reduce:animate-none" />
              : <Send aria-hidden className="mx-auto h-4 w-4" />}
          </Button>
        </div>
        {errorEnvio ? <p className={`mt-2 ${AVISO}`} role="alert">{errorEnvio}</p> : null}
      </div>
    </div>
  );
}

/* ── Monitor ── */

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
  const [mostrarConexion, setMostrarConexion] = useState(false);
  // Historial por chat: cambiar de conversación pinta lo que ya se leyó y
  // refresca callado por detrás, en vez de parpadear en blanco cada vez.
  const [historial, setHistorial] = useState<Record<string, Mensaje[]>>({});
  const [cargandoChat, setCargandoChat] = useState(false);
  const [errorChat, setErrorChat] = useState("");

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp-monitor");
      const data = await res.json();
      if (data.error && !data.contactos?.length) setError(data.error);
      setContactos(data.contactos ?? []);
      setEstado(data.estado ?? "error");
    } catch {
      // Un tropiezo de red durante el sondeo no pinta un error: la lista se
      // queda con lo último bueno y el siguiente intento la pone al día.
      if (!silencioso) setError("No se pudo conectar con el servidor");
    }
    setCargando(false);
  }, []);

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

  const cargarHistorial = useCallback(async (chatId: string, silencioso = false) => {
    if (!silencioso) setCargandoChat(true);
    setErrorChat("");
    try {
      const res = await fetch(`/api/whatsapp-monitor/historial?chatId=${encodeURIComponent(chatId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo leer la conversación");
      setHistorial((previo) => ({ ...previo, [chatId]: data.mensajes ?? [] }));
    } catch (e) {
      setErrorChat((e as Error).message);
    }
    setCargandoChat(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del monitor
    cargar();
    cargarEstadoWA();
  }, [cargar, cargarEstadoWA]);

  // El chat abierto se refresca solo, pero no mientras la pestaña está
  // escondida: ahí nadie lo está leyendo y cada consulta cuesta.
  useEffect(() => {
    if (!seleccionado) return;
    const t = setInterval(() => {
      if (!document.hidden) cargarHistorial(seleccionado.chatId, true);
    }, REFRESCO_CHAT_MS);
    return () => clearInterval(t);
  }, [seleccionado, cargarHistorial]);

  // La lista se sondea igual: así, cuando escribe un número que nadie tiene
  // guardado, el renglón aparece solo y con el nombre que la persona trae en su
  // perfil de WhatsApp, o con el número si no trae ninguno.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) cargar(true);
    }, REFRESCO_LISTA_MS);
    return () => clearInterval(t);
  }, [cargar]);

  // Escape cierra la conversación, salvo mientras se escribe: ahí borraría el
  // mensaje a medias sin avisar.
  useEffect(() => {
    if (!seleccionado) return;
    const cerrar = (e: KeyboardEvent) => {
      const destino = e.target as HTMLElement | null;
      if (e.key !== "Escape") return;
      if (destino?.tagName === "INPUT" || destino?.tagName === "TEXTAREA") return;
      setSeleccionado(null);
    };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [seleccionado]);

  function abrir(c: Contacto) {
    setSeleccionado(c);
    cargarHistorial(c.chatId, historial[c.chatId] !== undefined);
  }

  // Flechas arriba y abajo para recorrer la lista sin soltar el teclado.
  function moverFoco(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const filas = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-chat]")];
    const actual = filas.indexOf(document.activeElement as HTMLButtonElement);
    if (actual === -1) return;
    const siguiente = filas[actual + (e.key === "ArrowDown" ? 1 : -1)];
    if (!siguiente) return;
    e.preventDefault();
    siguiente.focus();
  }

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return contactos;
    const q = normalizar(busqueda);
    return contactos.filter(
      (c) => normalizar(c.nombre).includes(q) || normalizar(c.nombrePerfil).includes(q) || c.numero.includes(q)
    );
  }, [contactos, busqueda]);

  const conectado = estado === "authorized";

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-3 py-2.5 sm:px-4">
        <EstadoConexion conectado={conectado} cargando={estado === "cargando"} />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className={ACCION} onClick={() => cargar()} disabled={cargando}>
            <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${cargando ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Actualizar
          </Button>
          <button
            onClick={() => setMostrarConexion((v) => !v)}
            aria-expanded={mostrarConexion}
            aria-label="Conexión de WhatsApp"
            className={`${BOTON_ICONO} ${
              mostrarConexion
                ? "bg-titos-green-100 text-titos-green-700"
                : "text-black/60 hover:bg-black/5 hover:text-black/80"
            }`}
          >
            <Settings aria-hidden className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {mostrarConexion ? (
        <PanelConexion
          estadoWA={estadoWA}
          errorWA={errorWA}
          cargandoEstado={cargandoEstado}
          onRefresh={() => { cargarEstadoWA(); cargar(); }}
        />
      ) : null}

      {/* Dos columnas fijas en escritorio, cada una con su propio scroll: la
          lista no se mueve cuando llega un mensaje y la conversación no empuja
          la página. En pantallas chicas sólo cabe una, así que se turnan. */}
      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside
          className={`${seleccionado ? "hidden" : "flex"} min-w-0 flex-1 flex-col lg:flex lg:border-r lg:border-black/5`}
          aria-label="Conversaciones"
        >
          <div className="border-b border-black/5 px-3 py-2.5">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-titos-green-900">Conversaciones</h2>
              <span className="text-xs text-black/60">
                {cargando ? "Cargando…" : filtrados.length}
              </span>
            </div>
            <label className="sr-only" htmlFor="buscar-chat">Buscar conversación</label>
            <Input
              id="buscar-chat"
              icon={Search}
              type="search"
              placeholder="Nombre o número…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          {error ? (
            <div className="m-3 rounded-lg bg-titos-orange-100 px-3 py-2.5 text-sm text-titos-orange-700" role="alert">
              {mensajeConexion(error)}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={moverFoco}>
            {cargando && contactos.length === 0 ? (
              <EsqueletoLista />
            ) : filtrados.length === 0 ? (
              <PanelAviso
                titulo={busqueda ? "Sin resultados" : conectado ? "Todavía no hay conversaciones" : "WhatsApp no está vinculado"}
                detalle={
                  busqueda
                    ? `Ningún chat coincide con "${busqueda}". Prueba con el número completo.`
                    : conectado
                      ? "Aquí aparecen los chats con mensajes del último mes. En cuanto alguien escriba, sale en esta lista."
                      : "Vincula el teléfono para ver aquí sus conversaciones."
                }
                accion={
                  busqueda
                    ? { texto: "Limpiar búsqueda", onClick: () => setBusqueda("") }
                    : conectado
                      ? undefined
                      : { texto: "Abrir conexión", onClick: () => setMostrarConexion(true) }
                }
              />
            ) : (
              <div className="space-y-0.5 p-2">
                {filtrados.map((c) => {
                  const activo = seleccionado?.chatId === c.chatId;
                  return (
                    <button
                      key={c.chatId}
                      data-chat
                      type="button"
                      onClick={() => abrir(c)}
                      aria-current={activo ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors ${FOCO} ${
                        activo ? "bg-titos-green-100" : "hover:bg-titos-green-100/50"
                      }`}
                    >
                      <Avatar contacto={c} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-titos-green-900">{c.nombre}</span>
                        <span className="block truncate text-xs text-black/60">{c.ultimoTexto || c.numero}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-black/55">{formatFecha(c.ultimoMensaje)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section
          className={`${seleccionado ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}
          aria-label="Conversación"
        >
          {seleccionado ? (
            <Conversacion
              key={seleccionado.chatId}
              contacto={seleccionado}
              mensajes={historial[seleccionado.chatId]}
              cargando={cargandoChat}
              error={errorChat}
              onVolver={() => setSeleccionado(null)}
              onRecargar={() => cargarHistorial(seleccionado.chatId)}
            />
          ) : (
            <PanelAviso
              titulo="Elige una conversación"
              detalle="Se abre aquí, junto a la lista, para leerla y responder sin perder de vista los demás chats."
            />
          )}
        </section>
      </div>
    </Card>
  );
}
