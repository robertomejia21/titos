"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScanLine,
  Trash2,
  Receipt,
  Search,
  Banknote,
  ClipboardCheck,
  WifiOff,
  RefreshCw,
  ShoppingCart,
  X,
  DollarSign,
  Wifi,
  CreditCard,
  Ticket,
  TriangleAlert,
  Clock,
  ShieldAlert,
  Printer,
  Coins,
  Info,
  Keyboard,
  PlusCircle,
} from "lucide-react";
import { Button, Card, Input, Select, Modal, FormField, formatMoney } from "@/components/ui";
import { ProductoCombobox } from "@/components/ProductoCombobox";
import { MotivoPosSelector } from "@/components/MotivoPosSelector";
import { estadoCredito, formatFecha, type ClienteConCredito } from "@/lib/creditoCliente";
import { motivoRechazoDolares, topeDolaresEnPesos, type ReglasDolares } from "@/lib/dolares";
import { ETIQUETA_TIPO_TARJETA, TIPOS_TARJETA, type TipoTarjeta } from "@/lib/tarjetas";
import { imprimirHTML, abrirVentanaTicket, cerrarVentanaTicket } from "@/lib/print";
import { imprimirTicketVenta } from "@/lib/ticketVenta";
import { ArqueoModal } from "@/components/sucursal/ArqueoModal";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { RelojZona } from "@/components/RelojZona";
import { formatFechaHora, formatHora, formatFechaLarga } from "@/lib/zonasHorarias";
import {
  leerProductosCache,
  guardarProductosCache,
  leerInventarioCache,
  guardarInventarioCache,
  leerSesionCache,
  guardarSesionCache,
  leerCola,
  agregarACola,
  quitarDeCola,
  generarIdLocal,
  generarFolioLocal,
  type VentaPayload,
  type PagoPayload,
} from "@/lib/offlinePos";

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  alias?: string[];
  unidad: "pieza" | "kg";
  precioVenta: number;
  requierePesaje: boolean;
};

type LineaVenta = {
  productoId: string;
  sku: string;
  nombre: string;
  unidad: "pieza" | "kg";
  precioUnitario: number;
  cantidad: string;
};

type MetodoPago = "efectivo" | "efectivo_usd" | "tarjeta" | "transferencia" | "vales" | "credito";

const ETIQUETAS_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  efectivo_usd: "Efectivo en dólares",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales de despensa",
  credito: "Crédito del cliente",
};

/** Botones de cobro de un solo toque, en el orden en que se usan en el mostrador. */
const METODOS_RAPIDOS: { metodo: MetodoPago; etiqueta: string }[] = [
  { metodo: "efectivo", etiqueta: "Efectivo" },
  { metodo: "tarjeta", etiqueta: "Tarjeta" },
  { metodo: "efectivo_usd", etiqueta: "Dólares" },
  { metodo: "transferencia", etiqueta: "Transferencia" },
  { metodo: "vales", etiqueta: "Vales" },
  { metodo: "credito", etiqueta: "Crédito" },
];

type TerminalPos = { _id: string; alias: string; banco?: string; marca?: string };

type EmisorVale = { _id: string; nombre: string };

/** Lo que el servidor pudo deducir de la tarjeta de vales que se pasó. */
type LecturaVale = {
  bin: string;
  ultimos4: string;
  emisorId: string | null;
  emisorNombre: string;
  reconocida: boolean;
};

/** Reglas de dólares con las que arranca el punto de venta sin conexión. */
const REGLAS_DOLARES_DEFAULT: ReglasDolares = {
  aceptaPagos: true,
  denominacionMaxima: 0,
  porcentajeMaximo: 0,
  montoMaximoUsd: 0,
};

const TIPO_CAMBIO_CACHE_KEY = "titos-pos-tipo-cambio";
const TERMINALES_CACHE_KEY = "titos-pos-terminales";
const REGLAS_DOLARES_CACHE_KEY = "titos-pos-reglas-dolares";

/** Lee un valor cacheado del punto de venta; sirve para arrancar sin conexión. */
function leerCacheJson<T>(clave: string, fallback: T): T {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : fallback;
  } catch {
    return fallback;
  }
}

function guardarCacheJson(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // almacenamiento lleno o bloqueado: el punto de venta sigue funcionando
  }
}

type VentaItemResp = { nombreProducto: string; cantidad: number; unidad: string; precioUnitario: number; subtotal: number };
type PagoResp = {
  metodoPago: MetodoPago;
  monto: number;
  montoUsd?: number | null;
  tipoCambio?: number | null;
  terminalId?: string | null;
  terminalAlias?: string;
  tarjetaTipo?: TipoTarjeta | null;
  valeEmisorId?: string | null;
  valeEmisorNombre?: string;
  valeUltimos4?: string;
};
type VentaResp = {
  folio: string;
  fecha?: string;
  items: VentaItemResp[];
  total: number;
  pagos: PagoResp[];
  montoRecibido: number | null;
  cambio: number | null;
  esVentas2?: boolean;
  ventas2SecuenciaEfectivo?: number | null;
  offline?: boolean;
  clienteNombre?: string;
  creditoMonto?: number | null;
  creditoFechaVencimiento?: string | null;
};

/**
 * Cancelación que está esperando la autorización del supervisor.
 * "linea" quita un solo producto del carrito; "carrito" tira la venta completa
 * antes de cobrarla (vaciar o cancelar).
 */
type CancelacionPendiente = {
  tipo: "linea" | "carrito";
  titulo: string;
  lineas: LineaVenta[];
  productoId?: string;
  /** Si además de vaciar el carrito hay que limpiar las formas de pago. */
  limpiarPago?: boolean;
};

type MonedaCaja = "MXN" | "USD";

type RetiroResp = {
  folio: string;
  monto: number;
  moneda: MonedaCaja;
  motivo: string;
  usuarioNombre: string;
  fecha: string;
};

type SesionCaja = {
  _id: string;
  efectivoInicial: number;
  efectivoInicialUsd?: number;
  fechaApertura: string;
  usuarioAperturaId?: { nombre?: string } | string | null;
  offline?: boolean;
};

type ResumenCaja = {
  sesion: SesionCaja;
  cantidadVentas: number;
  cantidadRetiros: number;
  cantidadAbonos: number;
  cantidadDevoluciones: number;
  totalVentasEfectivo: number;
  totalVentasTarjeta: number;
  totalVentasTransferencia: number;
  totalVentasVales: number;
  totalVentasCredito: number;
  totalVentasDolaresUsd: number;
  totalVentasDolaresMxn: number;
  totalCambioDolaresMxn: number;
  tarjetaPorTerminal: { terminalId: string | null; alias: string; monto: number }[];
  tarjetaPorTipo: { tipo: string | null; etiqueta: string; monto: number }[];
  valesPorEmisor: { emisorId: string | null; nombre: string; monto: number }[];
  totalAbonosEfectivo: number;
  totalDevoluciones: number;
  totalRetiros: number;
  totalRetirosUsd: number;
  efectivoEsperado: number;
  efectivoEsperadoUsd: number;
};

function nombreCajero(sesion: SesionCaja | null) {
  if (!sesion || !sesion.usuarioAperturaId || typeof sesion.usuarioAperturaId === "string") return null;
  return sesion.usuarioAperturaId.nombre ?? null;
}

function formatDolares(value: number) {
  return `$${value.toFixed(2)}`;
}

/**
 * Atajos del punto de venta.
 *
 * Se eligieron teclas de función porque el mostrador se opera con una mano en
 * el lector y la otra en el teclado, sin mirar. Se evitaron a propósito F1
 * (ayuda del navegador), F3 (buscar en la página), F5 (recargar) y F12
 * (herramientas de desarrollo): el navegador se las queda antes que la página.
 *
 * Los Alt+letra viejos se conservan porque ya hay quien los tiene en los dedos.
 */
const ATAJOS_POS: { teclas: string; que: string; detalle?: string }[] = [
  { teclas: "F2", que: "Consultar precio", detalle: "Con opción de agregar el producto al carrito." },
  { teclas: "F4", que: "Cobrar", detalle: "Abre el cobro con el carrito capturado." },
  { teclas: "F6", que: "Retirar efectivo" },
  { teclas: "F7", que: "Corte de caja" },
  { teclas: "F8", que: "Cancelar la venta en curso", detalle: "Pide motivo y autorización." },
  { teclas: "F9", que: "Ir al lector de código", detalle: "Devuelve el cursor al campo de escaneo." },
  { teclas: "Alt + I", que: "Ver esta lista de atajos" },
  { teclas: "Esc", que: "Cerrar la ventana abierta" },
  { teclas: "Alt + C", que: "Consultar precio", detalle: "Equivale a F2." },
  { teclas: "Alt + R", que: "Retirar efectivo", detalle: "Equivale a F6." },
  { teclas: "Alt + T", que: "Corte de caja", detalle: "Equivale a F7." },
];

/**
 * Crédito / débito / American Express. Va como botonera y no como lista
 * desplegable porque en el mostrador se elige con el dedo y sin mirar.
 */
function SelectorTipoTarjeta({
  valor,
  onChange,
}: {
  valor: TipoTarjeta | "";
  onChange: (tipo: TipoTarjeta) => void;
}) {
  return (
    <FormField label="Tipo de tarjeta">
      <div className="flex flex-wrap gap-1.5">
        {TIPOS_TARJETA.map((tipo) => (
          <button
            key={tipo}
            type="button"
            onClick={() => onChange(tipo)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              valor === tipo ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
            }`}
          >
            {ETIQUETA_TIPO_TARJETA[tipo]}
          </button>
        ))}
      </div>
      {!valor ? (
        <p className="mt-1 text-xs text-amber-700">
          Márcalo antes de cobrar: el banco deposita cada uno por separado y así se cuadra el corte.
        </p>
      ) : null}
    </FormField>
  );
}

export function PuntoVentaForm({ sucursalNombre = "" }: { sucursalNombre?: string }) {
  const zonaHoraria = useZonaHoraria();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [inventario, setInventario] = useState<Map<string, number>>(new Map());
  const [codigo, setCodigo] = useState("");
  const [carrito, setCarrito] = useState<LineaVenta[]>([]);
  const [busquedaId, setBusquedaId] = useState("");
  const [pesaje, setPesaje] = useState<Producto | null>(null);
  const [pesoInput, setPesoInput] = useState("");
  const [montoEfectivo, setMontoEfectivo] = useState("");
  const [montoTarjeta, setMontoTarjeta] = useState("");
  const [montoTransferencia, setMontoTransferencia] = useState("");
  const [montoVales, setMontoVales] = useState("");
  const [montoCredito, setMontoCredito] = useState("");
  const [efectivoRecibido, setEfectivoRecibido] = useState("");
  // Dólares en billete que entrega el cliente. Se capturan igual en el cobro
  // rápido y en el mixto: lo que cambia es cuánto del total alcanzan a cubrir.
  const [dolaresRecibidos, setDolaresRecibidos] = useState("");
  // Cobro rápido (un solo método cubre el total) vs. pago mixto (se reparte a
  // mano entre varias formas). El mixto es la excepción, así que no es el modo
  // por omisión: antes obligaba a teclear el monto aunque solo hubiera uno.
  const [modoMixto, setModoMixto] = useState(false);
  const [metodoRapido, setMetodoRapido] = useState<MetodoPago>("efectivo");
  const [terminales, setTerminales] = useState<TerminalPos[]>([]);
  const [terminalId, setTerminalId] = useState("");
  // Crédito, débito o American Express: el banco liquida cada uno por separado,
  // así que el cajero lo marca al cobrar. No se deduce del plástico porque el
  // BIN dice la marca, no si la tarjeta es de crédito o de débito.
  const [tarjetaTipo, setTarjetaTipo] = useState<TipoTarjeta | "">("");
  const [reglasDolares, setReglasDolares] = useState<ReglasDolares>(REGLAS_DOLARES_DEFAULT);
  // --- Vales de despensa: la tarjeta se identifica sola por su BIN ---
  const [emisoresVale, setEmisoresVale] = useState<EmisorVale[]>([]);
  const [valeLectura, setValeLectura] = useState("");
  const [valeInfo, setValeInfo] = useState<LecturaVale | null>(null);
  const [valeEmisorId, setValeEmisorId] = useState("");
  const [leyendoVale, setLeyendoVale] = useState(false);
  const [errorVale, setErrorVale] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteConCredito[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cobroEnCurso = useRef(false);
  const [avisoImpresion, setAvisoImpresion] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [ventaCompletada, setVentaCompletada] = useState<VentaResp | null>(null);
  const [tipoCambio, setTipoCambio] = useState(0);
  const [modalCobro, setModalCobro] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Caja: apertura, retiro de efectivo y corte ---
  const [sesion, setSesion] = useState<SesionCaja | null | undefined>(undefined);
  const [efectivoInicialInput, setEfectivoInicialInput] = useState("");
  const [efectivoInicialUsdInput, setEfectivoInicialUsdInput] = useState("");
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  const [errorCaja, setErrorCaja] = useState<string | null>(null);

  const [modalRetiro, setModalRetiro] = useState(false);
  const [retiroMonto, setRetiroMonto] = useState("");
  const [retiroMotivo, setRetiroMotivo] = useState("");
  const [retiroMoneda, setRetiroMoneda] = useState<MonedaCaja>("MXN");
  const [retiroClave, setRetiroClave] = useState("");
  // Un retiro se autoriza de dos formas: el cajero con su propia clave, o el
  // encargado de turno con su NIP de 6 dígitos cuando autoriza en caja ajena.
  const [retiroConNip, setRetiroConNip] = useState(false);
  const [retiroNip, setRetiroNip] = useState("");
  const [retirando, setRetirando] = useState(false);
  const [errorRetiro, setErrorRetiro] = useState<string | null>(null);
  const [ultimoRetiro, setUltimoRetiro] = useState<RetiroResp | null>(null);

  const [modalCorte, setModalCorte] = useState(false);
  const [modalArqueo, setModalArqueo] = useState(false);
  const [resumenCorte, setResumenCorte] = useState<ResumenCaja | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [efectivoContadoUsd, setEfectivoContadoUsd] = useState("");
  const [notasCorte, setNotasCorte] = useState("");
  const [cerrandoCaja, setCerrandoCaja] = useState(false);
  const [errorCorte, setErrorCorte] = useState<string | null>(null);
  const [corteCerrado, setCorteCerrado] = useState<{
    efectivoEsperado: number;
    efectivoContado: number;
    diferencia: number;
    efectivoEsperadoUsd: number;
    efectivoContadoUsd: number;
    diferenciaUsd: number;
  } | null>(null);

  const [modalPrecio, setModalPrecio] = useState(false);
  const [precioCodigo, setPrecioCodigo] = useState("");
  const [precioResultado, setPrecioResultado] = useState<Producto | null | undefined>(undefined);
  // Cantidad con la que se agrega al carrito desde la consulta de precio: la
  // consulta rápida es lo normal, pero cuando el cliente dice "sí, dame dos"
  // obligar a cerrar y volver a escanear es una vuelta de más.
  const [precioCantidad, setPrecioCantidad] = useState("1");
  const [modalAtajos, setModalAtajos] = useState(false);

  // --- Cancelaciones: piden NIP de supervisor y quedan en la bitácora ---
  const [nipConfigurado, setNipConfigurado] = useState(false);
  const [cancelacion, setCancelacion] = useState<CancelacionPendiente | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cancelNip, setCancelNip] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);

  // --- Modo sin conexión: cache local + cola de acciones pendientes ---
  const [isOnline, setIsOnline] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroresSync, setErroresSync] = useState<string[]>([]);
  const sincronizandoRef = useRef(false);

  const sincronizarCola = useCallback(async () => {
    if (sincronizandoRef.current) return;
    sincronizandoRef.current = true;
    setSincronizando(true);

    const erroresNuevos: string[] = [];
    while (true) {
      const cola = leerCola();
      if (cola.length === 0) break;
      const accion = cola[0];
      let sinConexion = false;

      try {
        if (accion.tipo === "venta") {
          const res = await fetch("/api/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(accion.payload),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            erroresNuevos.push(`Venta pendiente: ${data.error || "no se pudo sincronizar"}`);
          }
        } else if (accion.tipo === "abrir_caja") {
          const res = await fetch("/api/caja/abrir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(accion.payload),
          });
          if (res.ok) {
            const data = await res.json();
            setSesion(data);
            guardarSesionCache(data);
          } else {
            const data = await res.json().catch(() => ({}));
            erroresNuevos.push(`Apertura de caja: ${data.error || "no se pudo sincronizar"}`);
          }
        } else {
          // Los retiros ya no se encolan (necesitan la clave del usuario), pero
          // puede quedar alguno de una versión anterior en la cola.
          const res = await fetch("/api/caja/retiros", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(accion.payload),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            erroresNuevos.push(`Retiro pendiente: ${data.error || "no se pudo sincronizar"}`);
          }
        }
      } catch {
        sinConexion = true;
      }

      if (sinConexion) break;
      quitarDeCola(accion.id);
      setPendientes(leerCola().length);
    }

    if (erroresNuevos.length > 0) setErroresSync((prev) => [...prev, ...erroresNuevos]);
    setSincronizando(false);
    sincronizandoRef.current = false;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee el estado real de conexión/cola al montar (no existe en el servidor)
    setIsOnline(navigator.onLine);
    setPendientes(leerCola().length);

    function handleOnline() {
      setIsOnline(true);
      sincronizarCola();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sincronizarCola]);

  useEffect(() => {
    fetch("/api/productos")
      .then((r) => r.json())
      .then((data) => {
        setProductos(data);
        guardarProductosCache(data);
      })
      .catch(() => setProductos(leerProductosCache<Producto[]>([])));

    fetch("/api/inventario-sucursal")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((rows: { productoId: string; stockActual: number }[]) => {
        const obj = Object.fromEntries(rows.map((r) => [r.productoId, r.stockActual]));
        setInventario(new Map(Object.entries(obj)));
        guardarInventarioCache(obj);
      })
      .catch(() => setInventario(new Map(Object.entries(leerInventarioCache()))));

    // Los clientes no se cachean para offline a propósito: sin conexión no se
    // puede validar el crédito contra su saldo real, así que no se fía.
    fetch("/api/clientes?soloActivos=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: ClienteConCredito[]) => setClientes(data))
      .catch(() => setClientes([]));

    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: { tipoCambio?: number; dolares?: Partial<ReglasDolares>; nipSupervisorConfigurado?: boolean }) => {
        const valor = Number(data.tipoCambio) || 0;
        const reglas: ReglasDolares = {
          aceptaPagos: data.dolares?.aceptaPagos !== false,
          denominacionMaxima: Number(data.dolares?.denominacionMaxima) || 0,
          porcentajeMaximo: Number(data.dolares?.porcentajeMaximo) || 0,
          montoMaximoUsd: Number(data.dolares?.montoMaximoUsd) || 0,
        };
        setTipoCambio(valor);
        setReglasDolares(reglas);
        setNipConfigurado(!!data.nipSupervisorConfigurado);
        try {
          localStorage.setItem(TIPO_CAMBIO_CACHE_KEY, String(valor));
        } catch {}
        guardarCacheJson(REGLAS_DOLARES_CACHE_KEY, reglas);
      })
      .catch(() => {
        try {
          setTipoCambio(Number(localStorage.getItem(TIPO_CAMBIO_CACHE_KEY)) || 0);
        } catch {}
        setReglasDolares(leerCacheJson<ReglasDolares>(REGLAS_DOLARES_CACHE_KEY, REGLAS_DOLARES_DEFAULT));
      });

    // Terminales de la tienda: se cachean para que un cobro con tarjeta también
    // se pueda capturar sin conexión y sincronizarse después.
    fetch("/api/vales?puntoVenta=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: EmisorVale[]) => setEmisoresVale(data))
      .catch(() => setEmisoresVale([]));

    fetch("/api/terminales?puntoVenta=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: TerminalPos[]) => {
        setTerminales(data);
        guardarCacheJson(TERMINALES_CACHE_KEY, data);
      })
      .catch(() => setTerminales(leerCacheJson<TerminalPos[]>(TERMINALES_CACHE_KEY, [])));

    fetch("/api/caja/actual")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data) => {
        setSesion(data);
        guardarSesionCache(data);
      })
      .catch(() => setSesion(leerSesionCache<SesionCaja>()))
      .finally(() => {
        if (leerCola().length > 0) sincronizarCola();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe ejecutarse al montar
  }, []);

  useEffect(() => {
    if (!pesaje && !ventaCompletada && !modalRetiro && !modalCorte && !modalArqueo && !modalPrecio && !modalCobro && !cancelacion) {
      inputRef.current?.focus();
    }
  }, [pesaje, ventaCompletada, modalRetiro, modalCorte, modalArqueo, modalPrecio, modalCobro, cancelacion, carrito]);

  const cargarResumenCorte = useCallback(async () => {
    if (!navigator.onLine) {
      setErrorCorte("Necesitas conexión a internet para hacer el corte de caja.");
      return;
    }
    setCargandoResumen(true);
    setErrorCorte(null);
    try {
      const res = await fetch("/api/caja/actual/resumen");
      if (!res.ok) {
        setErrorCorte("No se pudo calcular el resumen de la caja");
        return;
      }
      setResumenCorte(await res.json());
    } catch {
      setErrorCorte("Necesitas conexión a internet para hacer el corte de caja.");
    } finally {
      setCargandoResumen(false);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Con una ventana abierta los atajos se apagan: abrir el retiro encima
      // del cobro dejaría dos operaciones a medias.
      const hayModal =
        !!pesaje || !!ventaCompletada || modalRetiro || modalCorte || modalArqueo || modalPrecio || modalCobro || !!cancelacion || modalAtajos;

      const abrirPrecio = () => {
        setPrecioCodigo("");
        setPrecioResultado(undefined);
        setPrecioCantidad("1");
        setModalPrecio(true);
      };
      const abrirCorte = () => {
        setEfectivoContado("");
        setNotasCorte("");
        setCorteCerrado(null);
        setModalCorte(true);
        cargarResumenCorte();
      };

      if (e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "i") {
          e.preventDefault();
          setModalAtajos((v) => !v);
        } else if (hayModal) {
          return;
        } else if (key === "c") {
          e.preventDefault();
          abrirPrecio();
        } else if (key === "r" && sesion) {
          e.preventDefault();
          abrirModalRetiro();
        } else if (key === "t" && sesion) {
          e.preventDefault();
          abrirCorte();
        }
        return;
      }

      if (hayModal) return;

      switch (e.key) {
        case "F2":
          e.preventDefault();
          abrirPrecio();
          break;
        case "F4": {
          // Solo tiene sentido con un carrito capturado; si no, el atajo no
          // hace nada en lugar de abrir un cobro vacío.
          const hayQueCobrar = carrito.length > 0 && carrito.every((l) => Number(l.cantidad) > 0);
          if (!sesion || !hayQueCobrar) return;
          e.preventDefault();
          abrirCobro();
          break;
        }
        case "F6":
          if (!sesion) return;
          e.preventDefault();
          abrirModalRetiro();
          break;
        case "F7":
          if (!sesion) return;
          e.preventDefault();
          abrirCorte();
          break;
        case "F8":
          if (!sesion) return;
          e.preventDefault();
          cancelarVenta();
          break;
        case "F9":
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las acciones se leen del cierre en cada evento
  }, [
    sesion,
    cargarResumenCorte,
    carrito,
    pesaje,
    ventaCompletada,
    modalRetiro,
    modalCorte,
    modalArqueo,
    modalPrecio,
    modalCobro,
    cancelacion,
    modalAtajos,
  ]);

  const total = useMemo(
    () => carrito.reduce((sum, l) => sum + (Number(l.cantidad) || 0) * l.precioUnitario, 0),
    [carrito]
  );


  const totalDolares = tipoCambio > 0 ? total / tipoCambio : null;

  // Montos tecleados en el panel de pago mixto (solo se usan en ese modo).
  const mEfectivo = Number(montoEfectivo) || 0;
  const mTarjeta = Number(montoTarjeta) || 0;
  const mTransferencia = Number(montoTransferencia) || 0;
  const mVales = Number(montoVales) || 0;
  const mCredito = Number(montoCredito) || 0;

  const nDolaresUsd = Number(dolaresRecibidos) || 0;
  const valorDolaresMxn = Number((nDolaresUsd * tipoCambio).toFixed(2));

  /**
   * Formas de pago con las que se va a registrar la venta.
   *
   * En el cobro rápido un solo método cubre el total y no hay nada que teclear;
   * en el mixto se arma con lo capturado en cada renglón. Se calcula, no se
   * guarda en estado: así el monto nunca se queda desfasado del carrito.
   */
  const pagosVenta = useMemo<PagoResp[]>(() => {
    if (total <= 0) return [];

    if (!modoMixto) {
      if (metodoRapido === "efectivo_usd") {
        return nDolaresUsd > 0 ? [{ metodoPago: "efectivo_usd", monto: total, montoUsd: nDolaresUsd }] : [];
      }
      if (metodoRapido === "tarjeta") {
        return [
          {
            metodoPago: "tarjeta",
            monto: total,
            terminalId: terminalId || null,
            tarjetaTipo: tarjetaTipo || null,
          },
        ];
      }
      if (metodoRapido === "vales") {
        return [
          {
            metodoPago: "vales",
            monto: total,
            valeEmisorId: valeEmisorId || null,
            valeUltimos4: valeInfo?.ultimos4,
          },
        ];
      }
      return [{ metodoPago: metodoRapido, monto: total }];
    }

    const enPesos = mEfectivo + mTarjeta + mTransferencia + mVales + mCredito;
    // Los dólares cubren lo que quede después de lo tecleado; si alcanzan para
    // más, el sobrante se devuelve en pesos como con cualquier billete grande.
    const aplicadoUsd = Math.min(valorDolaresMxn, Math.max(0, Number((total - enPesos).toFixed(2))));

    return [
      ...(mEfectivo > 0 ? [{ metodoPago: "efectivo" as const, monto: mEfectivo }] : []),
      ...(aplicadoUsd > 0
        ? [{ metodoPago: "efectivo_usd" as const, monto: aplicadoUsd, montoUsd: nDolaresUsd }]
        : []),
      ...(mTarjeta > 0
        ? [
            {
              metodoPago: "tarjeta" as const,
              monto: mTarjeta,
              terminalId: terminalId || null,
              tarjetaTipo: tarjetaTipo || null,
            },
          ]
        : []),
      ...(mTransferencia > 0 ? [{ metodoPago: "transferencia" as const, monto: mTransferencia }] : []),
      ...(mVales > 0
        ? [
            {
              metodoPago: "vales" as const,
              monto: mVales,
              valeEmisorId: valeEmisorId || null,
              valeUltimos4: valeInfo?.ultimos4,
            },
          ]
        : []),
      ...(mCredito > 0 ? [{ metodoPago: "credito" as const, monto: mCredito }] : []),
    ];
  }, [
    total,
    modoMixto,
    metodoRapido,
    terminalId,
    tarjetaTipo,
    nDolaresUsd,
    valorDolaresMxn,
    valeEmisorId,
    valeInfo,
    mEfectivo,
    mTarjeta,
    mTransferencia,
    mVales,
    mCredito,
  ]);

  const montoDe = (metodo: MetodoPago) => pagosVenta.find((p) => p.metodoPago === metodo)?.monto ?? 0;

  // El lector aparece cuando la venta se va a cobrar con vales, en cualquiera
  // de los dos modos de cobro.
  const mostrarLectorVales = modoMixto ? mVales > 0 : metodoRapido === "vales";

  const nEfectivo = montoDe("efectivo");
  const nTarjeta = montoDe("tarjeta");
  const nDolaresMxn = montoDe("efectivo_usd");
  const nCredito = montoDe("credito");

  const sumaPagos = Number(pagosVenta.reduce((sum, p) => sum + p.monto, 0).toFixed(2));
  const restante = Number((total - sumaPagos).toFixed(2));

  // En el cobro rápido en efectivo, dejar el campo vacío significa "pagó justo":
  // es el caso más común del mostrador y antes obligaba a teclear el total dos
  // veces (una en la forma de pago y otra en el efectivo recibido).
  const cobroRapidoEfectivo = !modoMixto && metodoRapido === "efectivo";
  const efectivoRecibidoNum =
    cobroRapidoEfectivo && efectivoRecibido === "" ? nEfectivo : Number(efectivoRecibido) || 0;

  // El cambio de un pago en dólares se devuelve en pesos, así que se suma al del
  // efectivo para que el cajero vea un solo número.
  const cambioEfectivo = nEfectivo > 0 ? Number((efectivoRecibidoNum - nEfectivo).toFixed(2)) : null;
  const cambioDolares = nDolaresMxn > 0 ? Number((valorDolaresMxn - nDolaresMxn).toFixed(2)) : 0;
  const cambio =
    cambioEfectivo != null || cambioDolares > 0
      ? Number(((cambioEfectivo ?? 0) + cambioDolares).toFixed(2))
      : null;

  // Tope en pesos que admite esta venta en billete verde (null = sin tope por
  // porcentaje). Solo se le enseña al cajero cuando el cobro involucra dólares.
  const topeDolaresMxn = topeDolaresEnPesos(reglasDolares, total);
  const hayTopeDolares = topeDolaresMxn != null || reglasDolares.montoMaximoUsd > 0;
  const cobroTocaDolares = modoMixto ? reglasDolares.aceptaPagos && tipoCambio > 0 : metodoRapido === "efectivo_usd";
  const mostrarTopeDolares = hayTopeDolares && cobroTocaDolares && total > 0;

  const carritoValido = carrito.length > 0 && carrito.every((l) => Number(l.cantidad) > 0);

  const cliente = useMemo(() => clientes.find((c) => c._id === clienteId) ?? null, [clientes, clienteId]);

  const creditoDisponibleParaCobro =
    !!cliente && cliente.resumen.creditoActivo && !cliente.resumen.tieneVencidos && cliente.resumen.disponible > 0 && isOnline;

  // Mismas reglas que valida el servidor, para avisar antes de intentar cobrar.
  const errorCredito = useMemo(() => {
    if (nCredito <= 0) return null;
    if (!cliente) return "Selecciona al cliente para poder vender a crédito.";
    if (!cliente.resumen.creditoActivo) return `${cliente.nombre} no tiene crédito autorizado.`;
    if (cliente.resumen.tieneVencidos) {
      return `${cliente.nombre} tiene ${formatMoney(cliente.resumen.saldoVencido)} vencidos. Debe liquidarlos antes de volver a comprar a crédito.`;
    }
    if (nCredito - cliente.resumen.disponible > 0.005) {
      return `El monto excede su crédito disponible (${formatMoney(cliente.resumen.disponible)} de un límite de ${formatMoney(cliente.resumen.limite)}).`;
    }
    if (!isOnline) return "Sin conexión no se pueden registrar ventas a crédito.";
    return null;
  }, [nCredito, cliente, isOnline]);

  // La terminal solo se exige cuando la tienda ya dio de alta las suyas; el
  // servidor aplica la misma regla.
  const faltaTerminal = nTarjeta > 0 && terminales.length > 0 && !terminalId;
  // El tipo de tarjeta sí se exige siempre: sin él, el corte no se puede cuadrar
  // contra lo que deposita el banco de cada producto.
  const faltaTipoTarjeta = nTarjeta > 0 && !tarjetaTipo;
  // Los dólares entregados tienen que alcanzar para la parte que se les asignó.
  const dolaresInsuficientes = nDolaresMxn > 0 && valorDolaresMxn - nDolaresMxn < -0.01;

  const errorPago = useMemo(() => {
    if (nDolaresMxn > 0 && !reglasDolares.aceptaPagos) return "Por ahora no se están recibiendo pagos en dólares.";
    if (nDolaresMxn > 0 && tipoCambio <= 0) {
      return "Matriz todavía no configura el tipo de cambio; no se puede cobrar en dólares.";
    }
    if (dolaresInsuficientes) {
      return `Los ${nDolaresUsd.toFixed(2)} USD equivalen a ${formatMoney(valorDolaresMxn)} y falta cubrir ${formatMoney(nDolaresMxn)}.`;
    }
    // Mismos topes que valida el servidor, para avisar antes de intentar cobrar.
    const rechazoDolares = motivoRechazoDolares({
      reglas: reglasDolares,
      total,
      montoAplicado: nDolaresMxn,
      montoUsd: nDolaresUsd,
    });
    if (rechazoDolares) return rechazoDolares;
    if (faltaTerminal) return "Indica con cuál terminal se cobró.";
    if (faltaTipoTarjeta) return "Marca si la tarjeta fue de crédito, de débito o American Express.";
    if (nEfectivo > 0 && efectivoRecibidoNum < nEfectivo - 0.001) {
      return `El efectivo recibido no alcanza: faltan ${formatMoney(nEfectivo - efectivoRecibidoNum)}.`;
    }
    return null;
  }, [
    total,
    nDolaresMxn,
    nDolaresUsd,
    valorDolaresMxn,
    dolaresInsuficientes,
    faltaTerminal,
    faltaTipoTarjeta,
    nEfectivo,
    efectivoRecibidoNum,
    reglasDolares,
    tipoCambio,
  ]);

  const puedeCobrar =
    carritoValido && Math.abs(restante) < 0.01 && sumaPagos > 0 && !errorCredito && !errorPago;

  /** Rellena un renglón del pago mixto con lo que falte por asignar. */
  function completarCon(metodo: MetodoPago) {
    const otros =
      total -
      (metodo === "efectivo" ? 0 : mEfectivo) -
      (metodo === "tarjeta" ? 0 : mTarjeta) -
      (metodo === "transferencia" ? 0 : mTransferencia) -
      (metodo === "vales" ? 0 : mVales) -
      (metodo === "credito" ? 0 : mCredito) -
      (metodo === "efectivo_usd" ? 0 : Math.min(valorDolaresMxn, Math.max(0, total)));
    const valor = Math.max(0, Number(otros.toFixed(2)));
    const texto = valor ? String(valor) : "";
    if (metodo === "efectivo") setMontoEfectivo(texto);
    else if (metodo === "tarjeta") setMontoTarjeta(texto);
    else if (metodo === "transferencia") setMontoTransferencia(texto);
    else if (metodo === "vales") setMontoVales(texto);
    else if (metodo === "credito") setMontoCredito(texto);
  }

  /**
   * Lee la tarjeta de vales que acaba de pasar por el lector. El lector se
   * comporta como un teclado: escribe la banda de golpe y manda Enter.
   */
  async function leerTarjetaVale() {
    const lectura = valeLectura.trim();
    if (!lectura) return;

    setErrorVale(null);
    setLeyendoVale(true);
    try {
      const res = await fetch("/api/vales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectura }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorVale(data.error || "No se pudo leer la tarjeta");
        return;
      }
      const info: LecturaVale = await res.json();
      setValeInfo(info);
      setValeEmisorId(info.emisorId ?? "");
      // La banda ya no se conserva en pantalla: solo el BIN y los últimos 4.
      setValeLectura("");
    } catch {
      setErrorVale("Se perdió la conexión al leer la tarjeta.");
    } finally {
      setLeyendoVale(false);
    }
  }

  /**
   * La primera vez que aparece un BIN, el cajero dice de qué emisor es y el
   * sistema lo memoriza: a partir de ahí esa tarjeta se identifica sola.
   */
  async function enseñarEmisor(emisorId: string) {
    setValeEmisorId(emisorId);
    if (!valeInfo || valeInfo.reconocida || !emisorId) return;

    try {
      await fetch("/api/vales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bin: valeInfo.bin, emisorId }),
      });
      const nombre = emisoresVale.find((e) => e._id === emisorId)?.nombre ?? "";
      setValeInfo({ ...valeInfo, emisorId, emisorNombre: nombre, reconocida: true });
    } catch {
      // Si falla el aprendizaje la venta igual procede con el emisor elegido.
    }
  }

  /** Cambia de método en el cobro rápido, limpiando lo que ya no aplica. */
  function elegirMetodoRapido(metodo: MetodoPago) {
    setMetodoRapido(metodo);
    setError(null);
    if (metodo !== "efectivo") setEfectivoRecibido("");
    if (metodo !== "efectivo_usd") setDolaresRecibidos("");
    if (metodo !== "tarjeta") {
      setTerminalId("");
      setTarjetaTipo("");
    }
    if (metodo !== "vales") {
      setValeLectura("");
      setValeInfo(null);
      setValeEmisorId("");
      setErrorVale(null);
    }
    // El cliente elegido se conserva aunque se salga de crédito: sirve para el
    // ticket y para facturar después.
  }

  function agregarAlCarrito(producto: Producto, cantidad: number) {
    setCarrito((prev) => {
      const existente = prev.find((l) => l.productoId === producto._id);
      if (existente) {
        return prev.map((l) =>
          l.productoId === producto._id ? { ...l, cantidad: String((Number(l.cantidad) || 0) + cantidad) } : l
        );
      }
      return [
        ...prev,
        {
          productoId: producto._id,
          sku: producto.sku,
          nombre: producto.nombre,
          unidad: producto.unidad,
          precioUnitario: producto.precioVenta,
          cantidad: String(cantidad),
        },
      ];
    });
  }

  function buscarPorCodigo(codigo: string) {
    return productos.find((p) => p.sku.trim().toLowerCase() === codigo.trim().toLowerCase());
  }

  function procesarCodigo(e: React.FormEvent) {
    e.preventDefault();
    const valor = codigo.trim();
    setCodigo("");
    if (!valor) return;

    const producto = buscarPorCodigo(valor);
    if (!producto) {
      setError(`No se encontró ningún producto con el código "${valor}"`);
      return;
    }
    setError(null);

    if (producto.requierePesaje) {
      setPesaje(producto);
      setPesoInput("");
      return;
    }
    agregarAlCarrito(producto, 1);
  }

  function confirmarPesaje() {
    if (!pesaje) return;
    const peso = Number(pesoInput);
    if (!peso || peso <= 0) return;
    agregarAlCarrito(pesaje, peso);
    setPesaje(null);
    setPesoInput("");
  }

  function agregarPorBusqueda(productoId: string) {
    const producto = productos.find((p) => p._id === productoId);
    setBusquedaId("");
    if (!producto) return;
    if (producto.requierePesaje) {
      setPesaje(producto);
      setPesoInput("");
      return;
    }
    agregarAlCarrito(producto, 1);
  }

  function actualizarCantidad(productoId: string, cantidad: string) {
    setCarrito((prev) => prev.map((l) => (l.productoId === productoId ? { ...l, cantidad } : l)));
  }

  /**
   * Quitar productos del carrito o tirar la venta en curso son cancelaciones:
   * las autoriza un supervisor con su NIP y se registran en la bitácora que ve
   * matriz. Por eso todo pasa por el modal en vez de borrarse en el acto.
   */
  function pedirCancelacion(pendiente: CancelacionPendiente) {
    setCancelMotivo("");
    setCancelNip("");
    setCancelError(null);
    setCancelacion(pendiente);
  }

  function quitarLinea(productoId: string) {
    const linea = carrito.find((l) => l.productoId === productoId);
    if (!linea) return;
    pedirCancelacion({
      tipo: "linea",
      titulo: `Quitar ${linea.nombre}`,
      lineas: [linea],
      productoId,
    });
  }

  function vaciarCarrito() {
    if (carrito.length === 0) return;
    pedirCancelacion({ tipo: "carrito", titulo: "Vaciar el carrito", lineas: carrito });
  }

  function aplicarCancelacion(pendiente: CancelacionPendiente) {
    if (pendiente.tipo === "linea" && pendiente.productoId) {
      const productoId = pendiente.productoId;
      setCarrito((prev) => prev.filter((l) => l.productoId !== productoId));
    } else if (pendiente.limpiarPago) {
      limpiarCarritoYPago();
    } else {
      setCarrito([]);
    }
    setCancelacion(null);
  }

  async function confirmarCancelacion() {
    if (!cancelacion) return;
    setCancelError(null);

    const motivo = cancelMotivo.trim();
    if (!motivo) {
      setCancelError("Captura el motivo de la cancelación");
      return;
    }
    if (nipConfigurado && !cancelNip) {
      setCancelError("Captura el NIP de supervisor");
      return;
    }
    // El NIP se valida contra el servidor, así que sin conexión no se puede
    // autorizar (mismo criterio que los retiros de efectivo).
    if (!isOnline) {
      setCancelError("Sin conexión no se pueden autorizar cancelaciones: el NIP se valida en el servidor.");
      return;
    }

    setCancelando(true);
    try {
      const res = await fetch("/api/cancelaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: cancelacion.tipo,
          motivo,
          nip: cancelNip,
          items: cancelacion.lineas.map((l) => ({
            productoId: l.productoId,
            sku: l.sku,
            nombreProducto: l.nombre,
            unidad: l.unidad,
            cantidad: Number(l.cantidad) || 0,
            precioUnitario: l.precioUnitario,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCancelError(data.error || "No se pudo registrar la cancelación");
        return;
      }

      aplicarCancelacion(cancelacion);
    } catch {
      setCancelError("Se perdió la conexión. La cancelación no se registró, inténtalo de nuevo.");
    } finally {
      setCancelando(false);
    }
  }

  function aplicarDescuentoInventario() {
    setInventario((prev) => {
      const next = new Map(prev);
      for (const l of carrito) {
        const stock = next.get(l.productoId);
        if (stock != null) next.set(l.productoId, stock - (Number(l.cantidad) || 0));
      }
      guardarInventarioCache(Object.fromEntries(next));
      return next;
    });
  }

  function limpiarCarritoYPago() {
    setCarrito([]);
    setMontoEfectivo("");
    setMontoTarjeta("");
    setMontoTransferencia("");
    setMontoVales("");
    setMontoCredito("");
    setEfectivoRecibido("");
    setDolaresRecibidos("");
    setTerminalId("");
    setTarjetaTipo("");
    setValeLectura("");
    setValeInfo(null);
    setValeEmisorId("");
    setErrorVale(null);
    setModoMixto(false);
    setMetodoRapido("efectivo");
    setClienteId("");
  }

  /** Tras una venta a crédito o un abono, el disponible del cliente cambió. */
  async function recargarClientes() {
    try {
      const res = await fetch("/api/clientes?soloActivos=1");
      if (res.ok) setClientes(await res.json());
    } catch {
      // sin conexión el crédito ya está bloqueado, no pasa nada si falla
    }
  }

  function cancelarVenta() {
    setError(null);
    // Sin productos capturados no hay nada que cancelar: solo se limpian las
    // formas de pago, y eso no necesita autorización.
    if (carrito.length === 0) {
      limpiarCarritoYPago();
      return;
    }
    pedirCancelacion({
      tipo: "carrito",
      titulo: "Cancelar la venta en curso",
      lineas: carrito,
      limpiarPago: true,
    });
  }

  /**
   * Pasa el producto de la consulta de precio al carrito. Si se vende por
   * kilogramo se encadena con el modal de pesaje, igual que al escanearlo.
   */
  function agregarDesdeConsulta() {
    const producto = precioResultado;
    if (!producto) return;
    setModalPrecio(false);

    if (producto.requierePesaje) {
      setPesaje(producto);
      setPesoInput("");
      return;
    }

    const cantidad = Math.max(1, Math.floor(Number(precioCantidad) || 1));
    agregarAlCarrito(producto, cantidad);
  }

  function abrirCobro() {
    if (!carritoValido) return;
    setError(null);
    // Siempre se abre en cobro rápido en efectivo: es la venta de todos los días.
    setModoMixto(false);
    setMetodoRapido("efectivo");
    setEfectivoRecibido("");
    setDolaresRecibidos("");
    setTerminalId(terminales.length === 1 ? terminales[0]._id : "");
    setTarjetaTipo("");
    setModalCobro(true);
  }

  function registrarVentaOffline(payload: VentaPayload, ventanaTicket: Window | null) {
    const accionId = generarIdLocal();
    agregarACola({ id: accionId, tipo: "venta", creadaEn: new Date().toISOString(), payload });
    const cola = leerCola();
    if (!cola.some((accion) => accion.id === accionId)) throw new Error("La venta no se guardó en el equipo");
    setPendientes(cola.length);

    const ventaLocal: VentaResp = {
      folio: generarFolioLocal(),
      fecha: new Date().toISOString(),
      items: carrito.map((l) => ({
        nombreProducto: l.nombre,
        cantidad: Number(l.cantidad) || 0,
        unidad: l.unidad,
        precioUnitario: l.precioUnitario,
        subtotal: (Number(l.cantidad) || 0) * l.precioUnitario,
      })),
      total,
      pagos: payload.pagos.map((p) => ({
        ...p,
        // El tipo de cambio se sella con el que el punto de venta tenía en
        // pantalla; al sincronizar manda el suyo el servidor.
        tipoCambio: p.metodoPago === "efectivo_usd" ? tipoCambio : null,
        terminalAlias: terminales.find((t) => t._id === p.terminalId)?.alias,
      })),
      montoRecibido: payload.montoRecibido ?? null,
      cambio,
      // La regla de Notas de venta ("1 de cada N") solo la puede evaluar el
      // servidor, así que una venta sin conexión nunca se marca aquí: el
      // asterisco del ticket aparece al reimprimirlo ya sincronizada.
      esVentas2: false,
      clienteNombre: cliente?.nombre,
      offline: true,
    };

    aplicarDescuentoInventario();
    setModalCobro(false);
    setVentaCompletada(ventaLocal);
    imprimirTicket(ventaLocal, ventanaTicket);
    limpiarCarritoYPago();
  }

  /**
   * Manda la venta reintentando los cortes de red. Es seguro reintentar porque
   * el payload lleva `clienteOperacionId`: si el servidor ya la había guardado,
   * la segunda petición devuelve esa misma venta en lugar de cobrar de nuevo.
   */
  async function enviarVenta(payload: VentaPayload) {
    const esperas = [400, 1200];
    for (let intento = 0; ; intento++) {
      try {
        return await fetch("/api/ventas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // Que el servidor conteste un error no es motivo de reintento: solo se
        // reintenta cuando la petición ni siquiera llegó.
        if (intento >= esperas.length) throw err;
        await new Promise((resolve) => setTimeout(resolve, esperas[intento]));
      }
    }
  }

  async function cobrar() {
    if (!puedeCobrar || cobroEnCurso.current) return;
    setError(null);

    const pagos: PagoPayload[] = pagosVenta.map((p) => ({
      metodoPago: p.metodoPago,
      monto: p.monto,
      ...(p.montoUsd ? { montoUsd: p.montoUsd } : {}),
      ...(p.terminalId ? { terminalId: p.terminalId } : {}),
      ...(p.tarjetaTipo ? { tarjetaTipo: p.tarjetaTipo } : {}),
      ...(p.valeEmisorId ? { valeEmisorId: p.valeEmisorId } : {}),
      ...(p.valeUltimos4 ? { valeUltimos4: p.valeUltimos4 } : {}),
    }));

    const payload: VentaPayload = {
      // Se genera una sola vez por intento de cobro y viaja igual en el
      // reintento y en la cola sin conexión: es lo que impide el cobro doble
      // cuando la red se corta después de que el servidor ya guardó la venta.
      clienteOperacionId: generarIdLocal(),
      items: carrito.map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad) })),
      pagos,
      montoRecibido: nEfectivo > 0 ? efectivoRecibidoNum : undefined,
      clienteId: clienteId || undefined,
    };

    if (!isOnline) {
      // El crédito nunca se encola: sin servidor no hay forma de saber si el
      // cliente sigue dentro de su límite o si ya se le venció algo.
      if (nCredito > 0) {
        setError("Sin conexión no se puede vender a crédito. Cobra de contado o espera a que vuelva el servicio.");
        return;
      }
      cobroEnCurso.current = true;
      const ventanaTicket = abrirVentanaTicket();
      try { registrarVentaOffline(payload, ventanaTicket); }
      catch {
        cerrarVentanaTicket(ventanaTicket);
        setError("No se pudo guardar la venta sin conexión. Revisa el almacenamiento del equipo antes de volver a cobrar.");
      } finally { cobroEnCurso.current = false; }
      return;
    }

    cobroEnCurso.current = true;
    const ventanaTicket = abrirVentanaTicket();
    setProcesando(true);
    try {
      const res = await enviarVenta(payload);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        cerrarVentanaTicket(ventanaTicket);
        setError(data.error || "No se pudo registrar la venta");
        return;
      }

      const venta: VentaResp = await res.json();
      aplicarDescuentoInventario();
      setModalCobro(false);
      setVentaCompletada(venta);
      imprimirTicket(venta, ventanaTicket);
      const eraCredito = nCredito > 0;
      limpiarCarritoYPago();
      if (eraCredito) recargarClientes();
    } catch {
      // Se perdió la conexión y los reintentos tampoco pasaron: la venta no se
      // pierde, se encola. Si resultó que el servidor sí la había guardado, al
      // sincronizar el `clienteOperacionId` evita que se duplique.
      if (nCredito > 0) {
        cerrarVentanaTicket(ventanaTicket);
        setError("Se perdió la conexión y la venta es a crédito. Vuelve a intentarla cuando regrese el servicio.");
        return;
      }
      try { registrarVentaOffline(payload, ventanaTicket); }
      catch { cerrarVentanaTicket(ventanaTicket); setError("No se pudo guardar la venta localmente. Revisa la conexión y el historial antes de volver a cobrar."); }
    } finally {
      cobroEnCurso.current = false;
      setProcesando(false);
    }
  }

  function imprimirTicket(venta: VentaResp, ventanaPreparada?: Window | null) {
    try {
      const abierta = imprimirTicketVenta(venta, {
        sucursalNombre, zonaHoraria, cajero: nombreCajero(sesion ?? null) ?? "",
      }, ventanaPreparada);
      setAvisoImpresion(abierta ? "" : "La venta quedó guardada, pero no se pudo abrir la impresión. Usa Reimprimir ticket y permite las ventanas emergentes de este sitio.");
    } catch {
      cerrarVentanaTicket(ventanaPreparada ?? null);
      setAvisoImpresion("La venta quedó guardada. No se pudo preparar el ticket; intenta reimprimirlo.");
    }
  }

  function nuevaVenta() {
    setVentaCompletada(null);
  }

  function abrirCajaOffline(clienteOperacionId: string, efectivoInicial: number, efectivoInicialUsd: number) {
    agregarACola({
      id: generarIdLocal(),
      tipo: "abrir_caja",
      creadaEn: new Date().toISOString(),
      payload: { clienteOperacionId, efectivoInicial, efectivoInicialUsd },
    });
    setPendientes(leerCola().length);
    const sesionLocal: SesionCaja = {
      _id: `local-${generarIdLocal()}`,
      efectivoInicial,
      efectivoInicialUsd,
      fechaApertura: new Date().toISOString(),
      offline: true,
    };
    setSesion(sesionLocal);
    guardarSesionCache(sesionLocal);
    setEfectivoInicialInput("");
    setEfectivoInicialUsdInput("");
  }

  async function abrirCaja() {
    setErrorCaja(null);
    const efectivoInicial = Number(efectivoInicialInput);
    if (!Number.isFinite(efectivoInicial) || efectivoInicial < 0) {
      setErrorCaja("Captura el efectivo inicial con el que abres la caja");
      return;
    }
    const efectivoInicialUsd = Number(efectivoInicialUsdInput) || 0;
    if (efectivoInicialUsd < 0) {
      setErrorCaja("El fondo en dólares no puede ser negativo");
      return;
    }

    // El mismo id viaja al servidor y a la cola: si la respuesta se pierde, el
    // reintento devuelve la sesión que ya se abrió en vez de abrir otra.
    const clienteOperacionId = generarIdLocal();

    if (!isOnline) {
      abrirCajaOffline(clienteOperacionId, efectivoInicial, efectivoInicialUsd);
      return;
    }

    setAbriendoCaja(true);
    try {
      const res = await fetch("/api/caja/abrir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteOperacionId, efectivoInicial, efectivoInicialUsd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorCaja(data.error || "No se pudo abrir la caja");
        return;
      }
      const data = await res.json();
      setSesion(data);
      guardarSesionCache(data);
      setEfectivoInicialInput("");
      setEfectivoInicialUsdInput("");
    } catch {
      abrirCajaOffline(clienteOperacionId, efectivoInicial, efectivoInicialUsd);
    } finally {
      setAbriendoCaja(false);
    }
  }

  function abrirModalRetiro() {
    setRetiroMonto("");
    setRetiroMotivo("");
    setRetiroMoneda("MXN");
    setRetiroClave("");
    setRetiroConNip(false);
    setRetiroNip("");
    setErrorRetiro(null);
    setUltimoRetiro(null);
    setModalRetiro(true);
  }

  async function registrarRetiro() {
    setErrorRetiro(null);
    const monto = Number(retiroMonto);
    if (!monto || monto <= 0) {
      setErrorRetiro("Captura un monto válido");
      return;
    }
    const motivo = retiroMotivo.trim();
    if (!motivo) {
      setErrorRetiro("Captura el motivo del retiro");
      return;
    }
    if (retiroConNip ? retiroNip.length !== 6 : !retiroClave) {
      setErrorRetiro(
        retiroConNip
          ? "Captura el NIP de 6 dígitos del encargado de turno"
          : "Confirma tu clave de acceso para autorizar el retiro"
      );
      return;
    }
    // La autorización se valida contra el servidor, así que el retiro no se encola.
    if (!isOnline) {
      setErrorRetiro("Sin conexión no se pueden registrar retiros: la autorización se valida en el servidor.");
      return;
    }

    setRetirando(true);
    try {
      const res = await fetch("/api/caja/retiros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteOperacionId: generarIdLocal(),
          monto,
          motivo,
          moneda: retiroMoneda,
          ...(retiroConNip ? { nipSupervisor: retiroNip } : { password: retiroClave }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorRetiro(data.error || "No se pudo registrar el retiro");
        return;
      }
      const retiro: RetiroResp = await res.json();
      setRetiroClave("");
      setRetiroNip("");
      setUltimoRetiro(retiro);
    } catch {
      setErrorRetiro("Se perdió la conexión. El retiro no se registró, inténtalo de nuevo.");
    } finally {
      setRetirando(false);
    }
  }

  function imprimirTicketRetiro(retiro: RetiroResp) {
    const simbolo = retiro.moneda === "USD" ? "USD" : "MXN";
    const monto = retiro.moneda === "USD" ? formatDolares(retiro.monto) : formatMoney(retiro.monto);
    imprimirHTML(
      `Retiro ${retiro.folio}`,
      `
        <h1>Comprobante de retiro de efectivo</h1>
        <p class="subtitulo">Folio ${retiro.folio}</p>
        <table>
          <tbody>
            <tr><th>Sucursal</th><td>${sucursalNombre || "—"}</td></tr>
            <tr><th>Fecha y hora</th><td>${formatFechaLarga(retiro.fecha, zonaHoraria)} · ${formatHora(
              retiro.fecha,
              zonaHoraria
            )}</td></tr>
            <tr><th>Autorizó</th><td>${retiro.usuarioNombre || "—"}</td></tr>
            <tr><th>Moneda</th><td>${simbolo}</td></tr>
            <tr><th>Monto</th><td><strong>${monto} ${simbolo}</strong></td></tr>
            <tr><th>Motivo</th><td>${retiro.motivo}</td></tr>
          </tbody>
        </table>
        <p class="subtitulo" style="margin-top:32px">
          Firma de quien recibe: ______________________________
        </p>
      `,
      zonaHoraria
    );
  }

  async function confirmarCorte() {
    setErrorCorte(null);
    if (!isOnline) {
      setErrorCorte("Necesitas conexión a internet para hacer el corte de caja.");
      return;
    }
    const contado = Number(efectivoContado);
    if (!Number.isFinite(contado) || contado < 0) {
      setErrorCorte("Captura el efectivo contado");
      return;
    }
    const contadoUsd = Number(efectivoContadoUsd) || 0;
    if (contadoUsd < 0) {
      setErrorCorte("Los dólares contados no pueden ser negativos");
      return;
    }
    setCerrandoCaja(true);
    try {
      const res = await fetch("/api/caja/cerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          efectivoContado: contado,
          efectivoContadoUsd: contadoUsd,
          notas: notasCorte.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorCorte(data.error || "No se pudo cerrar la caja");
        return;
      }
      const cerrada = await res.json();
      setCorteCerrado({
        efectivoEsperado: cerrada.efectivoEsperado,
        efectivoContado: cerrada.efectivoContado,
        diferencia: cerrada.diferencia,
        efectivoEsperadoUsd: cerrada.efectivoEsperadoUsd ?? 0,
        efectivoContadoUsd: cerrada.efectivoContadoUsd ?? 0,
        diferenciaUsd: cerrada.diferenciaUsd ?? 0,
      });
      setSesion(null);
      guardarSesionCache(null);
    } catch {
      setErrorCorte("Se perdió la conexión a internet. Intenta de nuevo cuando vuelva la señal.");
    } finally {
      setCerrandoCaja(false);
    }
  }

  function cerrarModalCorte() {
    setModalCorte(false);
    setCorteCerrado(null);
  }

  function buscarPrecio(e: React.FormEvent) {
    e.preventDefault();
    if (!precioCodigo.trim()) return;
    setPrecioResultado(buscarPorCodigo(precioCodigo) ?? null);
  }

  const productosDisponibles = useMemo(
    () => productos.filter((p) => !carrito.some((l) => l.productoId === p._id)),
    [productos, carrito]
  );

  const bannerSync =
    erroresSync.length > 0 ? (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <div>
          <p className="font-semibold">No se pudieron sincronizar algunas acciones:</p>
          <ul className="mt-1 list-inside list-disc">
            {erroresSync.map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        </div>
        <button onClick={() => setErroresSync([])} className="shrink-0 text-xs font-medium underline">
          Descartar
        </button>
      </div>
    ) : null;

  const badgeConexion = !isOnline ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
      <WifiOff className="h-3.5 w-3.5" />
      Sin conexión{pendientes > 0 ? ` · ${pendientes} por sincronizar` : ""}
    </span>
  ) : pendientes > 0 ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
      <RefreshCw className={`h-3.5 w-3.5 ${sincronizando ? "animate-spin" : ""}`} />
      {sincronizando ? "Sincronizando..." : `${pendientes} pendiente(s) por sincronizar`}
    </span>
  ) : null;

  if (sesion === undefined) {
    return <p className="text-sm text-black/50">Cargando punto de venta...</p>;
  }

  if (sesion === null) {
    return (
      <div className="space-y-4">
        {bannerSync}
        <Card className="mx-auto max-w-md">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-titos-green-900">Abrir caja</h2>
            {badgeConexion}
          </div>
          <p className="mb-4 text-sm text-black/50">
            Antes de registrar ventas, captura el efectivo con el que inicias esta caja.
            {!isOnline ? " Puedes abrirla sin conexión: se sincronizará en cuanto vuelva la señal." : ""}
          </p>
          <FormField label="Efectivo inicial (pesos)" className="mb-3">
            <Input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={efectivoInicialInput}
              onChange={(e) => setEfectivoInicialInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") abrirCaja();
              }}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="Fondo en dólares (opcional)">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={efectivoInicialUsdInput}
              onChange={(e) => setEfectivoInicialUsdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") abrirCaja();
              }}
              placeholder="0.00"
            />
          </FormField>
          {errorCaja ? <p className="mt-2 text-sm text-red-600">{errorCaja}</p> : null}
          <Button onClick={abrirCaja} disabled={abriendoCaja} className="mt-4 w-full justify-center">
            {abriendoCaja ? "Abriendo..." : "Abrir caja"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {bannerSync}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
        {/* Barra superior tipo menú */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-[#eef3fa] px-2 py-1">
          <div className="flex flex-wrap items-center">
            <button
              onClick={() => {
                setPrecioCodigo("");
                setPrecioResultado(undefined);
                setPrecioCantidad("1");
                setModalPrecio(true);
              }}
              className="rounded px-2.5 py-1 text-sm text-black/70 hover:bg-black/5"
            >
              Consultar precio <span className="text-xs text-black/35">(F2)</span>
            </button>
            <button
              onClick={() => {
                abrirModalRetiro();
              }}
              className="rounded px-2.5 py-1 text-sm text-black/70 hover:bg-black/5"
            >
              Retirar efectivo <span className="text-xs text-black/35">(F6)</span>
            </button>
            <button
              onClick={() => {
                setEfectivoContado("");
                setNotasCorte("");
                setCorteCerrado(null);
                setModalCorte(true);
                cargarResumenCorte();
              }}
              className="rounded px-2.5 py-1 text-sm text-black/70 hover:bg-black/5"
            >
              Corte de caja <span className="text-xs text-black/35">(F7)</span>
            </button>
            <button onClick={() => setModalArqueo(true)} className="rounded px-2.5 py-1 text-sm text-black/70 hover:bg-black/5">Arqueo</button>
            {/* La lista completa de atajos: en el mostrador nadie se aprende
                seis teclas de memoria, pero sí se acuerda de dónde verlas. */}
            <button
              onClick={() => setModalAtajos(true)}
              title="Ver los atajos de teclado (Alt+I)"
              aria-label="Ver los atajos de teclado"
              className="ml-1 rounded-full p-1 text-titos-green-700 hover:bg-titos-green-100"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pr-1 text-xs text-black/50">
            {badgeConexion}
            <span>
              Caja abierta {sesion.offline ? "(sin sincronizar)" : ""} · {formatMoney(sesion.efectivoInicial)} · desde
              las {formatHora(sesion.fechaApertura, zonaHoraria)}
              {nombreCajero(sesion) ? ` · ${nombreCajero(sesion)}` : ""}
            </span>
            <span className="flex items-center gap-1 border-l border-black/10 pl-2 font-medium tabular-nums text-black/70">
              <Clock size={13} className="text-black/35" />
              <RelojZona />
            </span>
          </div>
        </div>

        {/* Búsqueda */}
        <div className="flex flex-col gap-2 border-b border-black/5 px-3 py-3 md:flex-row md:items-center">
          <div className="flex flex-1 items-center gap-3">
            <ShoppingCart className="hidden h-7 w-7 shrink-0 text-black/50 sm:block" />
            <form onSubmit={procesarCodigo} className="flex flex-1">
              <Input
                ref={inputRef}
                icon={ScanLine}
                autoFocus
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Escanea o escribe el código y presiona Enter"
                className="rounded-r-none border-r-0 text-base"
              />
              <button
                type="submit"
                title="Agregar por código"
                className="rounded-r-lg bg-sky-600 px-3.5 text-white transition-colors hover:bg-sky-700"
              >
                <Search className="h-4 w-4" />
              </button>
            </form>
          </div>
          <div className="w-full md:w-72">
            <ProductoCombobox
              productos={productosDisponibles}
              value={busquedaId}
              onChange={agregarPorBusqueda}
              placeholder="Buscar por nombre o SKU..."
            />
          </div>
        </div>
        {error ? <p className="border-b border-black/5 px-4 py-2 text-sm text-red-600">{error}</p> : null}

        {/* Cuerpo: tabla + panel derecho */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-85 flex-1 overflow-auto lg:min-h-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-linear-to-b from-sky-500 to-sky-600 text-white">
                  <th className="px-3 py-2 font-semibold">Código</th>
                  <th className="px-2 py-2 font-semibold">Artículo</th>
                  <th className="px-2 py-2 text-right font-semibold">Cantidad</th>
                  <th className="px-2 py-2 text-right font-semibold">Precio</th>
                  <th className="px-2 py-2 text-right font-semibold">Descuento</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {carrito.map((l) => {
                  const stock = inventario.get(l.productoId);
                  const cantidad = Number(l.cantidad) || 0;
                  const sinStock = stock != null && cantidad > stock;
                  return (
                    <tr key={l.productoId} className="border-b border-black/5 odd:bg-white even:bg-sky-50/60">
                      <td className="px-3 py-1.5 font-mono text-xs text-black/60">{l.sku}</td>
                      <td className="px-2 py-1.5 font-medium uppercase">
                        {l.nombre}
                        {sinStock ? (
                          <p className="text-xs font-normal normal-case text-red-600">Stock disponible: {stock}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min="0"
                            step={l.unidad === "kg" ? "0.001" : "1"}
                            value={l.cantidad}
                            onChange={(e) => actualizarCantidad(l.productoId, e.target.value)}
                            className="w-20 py-1 text-right"
                          />
                          <span className="text-xs text-black/40">{l.unidad}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-black/70">{formatMoney(l.precioUnitario)}</td>
                      <td className="px-2 py-1.5 text-right text-black/40">$0.00</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{formatMoney(cantidad * l.precioUnitario)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => quitarLinea(l.productoId)}
                          className="text-red-500 hover:text-red-700"
                          title="Quitar (requiere autorización)"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {carrito.length === 0 ? (
              <p className="px-4 py-16 text-center text-sm text-black/40">
                Escanea o busca productos para iniciar la venta.
              </p>
            ) : null}
          </div>

          {/* Panel derecho de totales */}
          <div className="w-full shrink-0 space-y-2 border-t border-black/10 bg-[#f4f8fc] p-3 lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-black/10 bg-white px-2 py-1.5">
                <p className="text-xs font-semibold text-black/50">Artículos</p>
                <p className="text-lg font-bold text-black/80">{carrito.length}</p>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-2 py-1.5">
                <p className="text-xs font-semibold text-black/50">Tipo de cambio</p>
                <p className="text-lg font-bold text-black/80">{tipoCambio > 0 ? formatDolares(tipoCambio) : "—"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm">
              <span className="font-semibold uppercase text-black/50">Total en dólares:</span>
              <span className="font-bold text-black/80">{totalDolares != null ? formatDolares(totalDolares) : "—"}</span>
            </div>

            <div className="space-y-1 rounded-lg bg-linear-to-b from-sky-500 to-sky-600 px-3 py-2 text-white">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Pago:</span>
                <span className="font-bold">{formatMoney(sumaPagos)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold uppercase">Cambio pesos:</span>
                <span className="font-bold">{formatMoney(cambio != null && cambio > 0 ? cambio : 0)}</span>
              </div>
            </div>

            <div className="space-y-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-sky-700">Subtotal</span>
                <span className="font-bold text-sky-700">{formatMoney(total)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold uppercase text-black/50">Descuento</span>
                <span className="font-bold text-black/50">{formatMoney(0)}</span>
              </div>
            </div>

            <div className="rounded-lg bg-linear-to-b from-sky-500 to-sky-600 px-3 py-2 text-right text-white">
              <p className="text-sm font-bold uppercase tracking-wide">Total pesos</p>
              <p className="text-4xl font-extrabold leading-tight">{formatMoney(total)}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                onClick={vaciarCarrito}
                disabled={carrito.length === 0}
                title="Vaciar carrito (requiere autorización)"
                className="grid h-12 place-items-center rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-5 w-5" />
              </button>
              <button
                onClick={cancelarVenta}
                disabled={carrito.length === 0 && sumaPagos === 0}
                title="Cancelar venta — F8 (requiere autorización)"
                className="grid h-12 place-items-center rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                onClick={abrirCobro}
                disabled={!carritoValido}
                title="Cobrar — F4"
                className="grid h-12 place-items-center rounded-lg bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <DollarSign className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>

        {/* Barra inferior */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 bg-[#eef3fa] px-3 py-1.5 text-xs text-black/60">
          <span className="font-semibold uppercase">
            Sucursal: {sucursalNombre || "—"} · Estación: Caja 1
          </span>
          <span className="inline-flex items-center gap-1.5">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600" /> Servicio en línea
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-600" /> Sin conexión
              </>
            )}
          </span>
        </div>
      </div>

      {modalCobro ? (
        <Modal open onClose={() => setModalCobro(false)} title="Cobrar venta" icon={DollarSign}>
          <p className="text-sm text-black/50">Total a pagar</p>
          <p className="mb-1 text-3xl font-bold text-titos-green-900">{formatMoney(total)}</p>
          {totalDolares != null ? (
            <p className="mb-3 text-sm font-semibold text-sky-700">
              Total en dólares: {formatDolares(totalDolares)}{" "}
              <span className="font-normal text-black/40">(tipo de cambio {formatDolares(tipoCambio)})</span>
            </p>
          ) : (
            <div className="mb-3" />
          )}

          <FormField label="Cliente (opcional)" className="mb-2">
            <Select
              icon={ShoppingCart}
              value={clienteId}
              onChange={(e) => {
                setClienteId(e.target.value);
                setMontoCredito("");
              }}
            >
              <option value="">Público en general</option>
              {clientes.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.nombre}
                  {c.resumen.creditoActivo ? ` — disponible ${formatMoney(c.resumen.disponible)}` : ""}
                </option>
              ))}
            </Select>
          </FormField>

          {cliente ? (
            <div
              className={`mb-2 rounded-lg p-2.5 text-xs ${
                cliente.resumen.tieneVencidos ? "bg-red-50 text-red-700" : "bg-black/3 text-black/60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${estadoCredito(cliente.resumen).className}`}>
                  {estadoCredito(cliente.resumen).label}
                </span>
                {cliente.resumen.creditoActivo ? (
                  <>
                    <span>
                      Debe <strong>{formatMoney(cliente.resumen.saldo)}</strong> de {formatMoney(cliente.resumen.limite)}
                    </span>
                    <span>
                      Disponible <strong>{formatMoney(cliente.resumen.disponible)}</strong>
                    </span>
                    <span>Plazo {cliente.resumen.diasCredito} días</span>
                    {cliente.resumen.proximoVencimiento && !cliente.resumen.tieneVencidos ? (
                      <span>Próximo pago {formatFecha(cliente.resumen.proximoVencimiento, zonaHoraria)}</span>
                    ) : null}
                  </>
                ) : (
                  <span>Sin crédito autorizado — solo contado</span>
                )}
              </div>
              {cliente.resumen.tieneVencidos ? (
                <p className="mt-1.5 flex items-start gap-1.5 font-semibold">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Tiene {formatMoney(cliente.resumen.saldoVencido)} vencidos. Debe liquidarlos para volver a comprar a
                  crédito.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Cobro rápido: un solo método cubre el total y no hay nada que teclear.
              El pago mixto queda detrás de un botón porque es la excepción. */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {METODOS_RAPIDOS.map(({ metodo, etiqueta }) => {
              const bloqueado =
                (metodo === "credito" && !creditoDisponibleParaCobro) ||
                (metodo === "efectivo_usd" && (!reglasDolares.aceptaPagos || tipoCambio <= 0));
              const activo = !modoMixto && metodoRapido === metodo;
              return (
                <button
                  key={metodo}
                  type="button"
                  disabled={modoMixto || bloqueado}
                  onClick={() => elegirMetodoRapido(metodo)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    activo ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                  }`}
                >
                  {etiqueta}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setModoMixto((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                modoMixto ? "bg-sky-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
              }`}
            >
              {modoMixto ? "Volver a cobro rápido" : "Pago mixto"}
            </button>
          </div>

          {!modoMixto ? (
            <div className="mb-3 space-y-2">
              {metodoRapido === "efectivo" ? (
                <FormField label="Recibido del cliente (déjalo vacío si pagó justo)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={efectivoRecibido}
                    onChange={(e) => setEfectivoRecibido(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && puedeCobrar && !procesando) cobrar();
                    }}
                    placeholder={formatMoney(total)}
                  />
                </FormField>
              ) : null}

              {metodoRapido === "efectivo_usd" ? (
                <FormField label="Dólares recibidos del cliente">
                  <Input
                    icon={Coins}
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={dolaresRecibidos}
                    onChange={(e) => setDolaresRecibidos(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && puedeCobrar && !procesando) cobrar();
                    }}
                    placeholder={totalDolares != null ? totalDolares.toFixed(2) : "0.00"}
                  />
                </FormField>
              ) : null}

              {metodoRapido === "tarjeta" ? (
                <SelectorTipoTarjeta valor={tarjetaTipo} onChange={setTarjetaTipo} />
              ) : null}

              {metodoRapido === "tarjeta" && terminales.length > 0 ? (
                <FormField label="Terminal con la que se cobró">
                  <Select icon={CreditCard} value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                    <option value="">Elige la terminal</option>
                    {terminales.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.alias}
                        {t.banco ? ` — ${t.banco}` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              {metodoRapido !== "efectivo" && metodoRapido !== "efectivo_usd" ? (
                <p className="rounded-lg bg-black/3 px-3 py-2 text-sm text-black/60">
                  Se cobrarán <strong>{formatMoney(total)}</strong> con {ETIQUETAS_METODO[metodoRapido].toLowerCase()}.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium text-black/40">
                Reparte el total entre las formas de pago. &quot;Completar&quot; pone lo que falte.
              </p>

              <div className="mb-2 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={montoEfectivo}
                    onChange={(e) => setMontoEfectivo(e.target.value)}
                    placeholder="Efectivo"
                  />
                  <button
                    type="button"
                    onClick={() => completarCon("efectivo")}
                    className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline"
                  >
                    Completar
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={montoTarjeta}
                    onChange={(e) => setMontoTarjeta(e.target.value)}
                    placeholder="Tarjeta"
                  />
                  <button
                    type="button"
                    onClick={() => completarCon("tarjeta")}
                    className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline"
                  >
                    Completar
                  </button>
                </div>
                {nTarjeta > 0 ? <SelectorTipoTarjeta valor={tarjetaTipo} onChange={setTarjetaTipo} /> : null}
                {nTarjeta > 0 && terminales.length > 0 ? (
                  <Select icon={CreditCard} value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                    <option value="">Elige la terminal con la que se cobró</option>
                    {terminales.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.alias}
                        {t.banco ? ` — ${t.banco}` : ""}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={montoTransferencia}
                    onChange={(e) => setMontoTransferencia(e.target.value)}
                    placeholder="Transferencia"
                  />
                  <button
                    type="button"
                    onClick={() => completarCon("transferencia")}
                    className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline"
                  >
                    Completar
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    icon={Ticket}
                    type="number"
                    min="0"
                    step="0.01"
                    value={montoVales}
                    onChange={(e) => setMontoVales(e.target.value)}
                    placeholder="Vales de despensa"
                  />
                  <button
                    type="button"
                    onClick={() => completarCon("vales")}
                    className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline"
                  >
                    Completar
                  </button>
                </div>
                {reglasDolares.aceptaPagos && tipoCambio > 0 ? (
                  <Input
                    icon={Coins}
                    type="number"
                    min="0"
                    step="0.01"
                    value={dolaresRecibidos}
                    onChange={(e) => setDolaresRecibidos(e.target.value)}
                    placeholder="Dólares recibidos (billete)"
                  />
                ) : null}
                <div className="flex items-center gap-1.5">
                  <Input
                    icon={CreditCard}
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!creditoDisponibleParaCobro}
                    value={montoCredito}
                    onChange={(e) => setMontoCredito(e.target.value)}
                    placeholder={
                      creditoDisponibleParaCobro
                        ? `Crédito (hasta ${formatMoney(cliente!.resumen.disponible)})`
                        : "Crédito — elige un cliente con crédito vigente"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => completarCon("credito")}
                    disabled={!creditoDisponibleParaCobro}
                    className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline disabled:cursor-not-allowed disabled:text-black/25 disabled:no-underline"
                  >
                    Completar
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Lector de tarjetas de vales: identifica sola la tarjeta por su BIN.
              La primera vez que aparece un emisor nuevo el cajero lo dice una
              vez y el sistema lo memoriza. */}
          {mostrarLectorVales ? (
            <div className="mb-3 space-y-2 rounded-lg border border-black/10 p-3">
              <FormField label="Tarjeta de vales">
                <Input
                  icon={ScanLine}
                  autoFocus={!modoMixto}
                  value={valeLectura}
                  onChange={(e) => setValeLectura(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      leerTarjetaVale();
                    }
                  }}
                  onBlur={() => {
                    if (valeLectura.trim()) leerTarjetaVale();
                  }}
                  placeholder={leyendoVale ? "Leyendo..." : "Pasa la tarjeta o escribe los primeros 6 dígitos"}
                />
              </FormField>

              {valeInfo ? (
                valeInfo.reconocida ? (
                  <p className="rounded-lg bg-titos-green-100 px-3 py-2 text-xs font-semibold text-titos-green-800">
                    {valeInfo.emisorNombre} · terminación {valeInfo.ultimos4}
                    <span className="ml-1 font-normal text-titos-green-700/70">(identificada por BIN {valeInfo.bin})</span>
                  </p>
                ) : (
                  <div className="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-800">
                      Tarjeta nueva (BIN {valeInfo.bin} · terminación {valeInfo.ultimos4}). ¿De qué emisor es?
                    </p>
                    <Select value={valeEmisorId} onChange={(e) => enseñarEmisor(e.target.value)}>
                      <option value="">Elige el emisor</option>
                      {emisoresVale.map((em) => (
                        <option key={em._id} value={em._id}>
                          {em.nombre}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-amber-700">
                      Solo se pregunta esta vez: las siguientes tarjetas de ese emisor se reconocen solas.
                    </p>
                  </div>
                )
              ) : null}

              {errorVale ? <p className="text-xs font-semibold text-red-600">{errorVale}</p> : null}
            </div>
          ) : null}

          {nDolaresUsd > 0 ? (
            <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
              {nDolaresUsd.toFixed(2)} USD × {formatMoney(tipoCambio)} = {formatMoney(valorDolaresMxn)}
              {reglasDolares.denominacionMaxima > 0
                ? ` · No se reciben billetes mayores a ${reglasDolares.denominacionMaxima} USD`
                : ""}
            </p>
          ) : null}

          {/* Cuánto de esta venta se puede recibir en dólares. Se muestra en
              cuanto el cobro toca dólares, para que el cajero lo sepa antes de
              recibir el billete y no después de teclearlo. */}
          {mostrarTopeDolares ? (
            <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
              Tope en dólares para esta venta:{" "}
              {topeDolaresMxn != null ? (
                <>
                  {formatMoney(topeDolaresMxn)} ({reglasDolares.porcentajeMaximo}% del total)
                </>
              ) : (
                "sin límite por porcentaje"
              )}
              {reglasDolares.montoMaximoUsd > 0
                ? ` · máximo ${reglasDolares.montoMaximoUsd.toFixed(2)} USD por venta`
                : ""}
              . El resto se cobra en otra forma de pago.
            </p>
          ) : null}

          {errorCredito ? (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {errorCredito}
            </p>
          ) : null}

          {errorPago && !errorCredito ? (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {errorPago}
            </p>
          ) : null}

          {modoMixto ? (
            <p className={`mb-3 text-sm font-semibold ${restante > 0 ? "text-red-600" : "text-black/40"}`}>
              {restante > 0
                ? `Restante por asignar: ${formatMoney(restante)}`
                : restante < 0
                  ? `Te pasaste por ${formatMoney(Math.abs(restante))}`
                  : "Pago completo"}
            </p>
          ) : null}

          {cambio != null && cambio > 0 ? (
            <p className="mb-3 text-sm font-semibold text-titos-green-700">
              Cambio: {formatMoney(cambio)}
              {cambioDolares > 0 ? <span className="font-normal text-black/40"> (en pesos)</span> : null}
            </p>
          ) : null}

          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalCobro(false)}>
              Cancelar
            </Button>
            <Button onClick={cobrar} disabled={!puedeCobrar || procesando}>
              {procesando ? "Procesando..." : "Cobrar"}
            </Button>
          </div>
        </Modal>
      ) : null}

      {pesaje ? (
        <Modal open onClose={() => setPesaje(null)} title={`Capturar peso — ${pesaje.nombre}`} icon={ScanLine}>
          <p className="mb-3 text-sm text-black/50">Este producto se vende por kilogramo. Captura el peso pesado.</p>
          <FormField label="Peso (kg)">
            <Input
              type="number"
              min="0"
              step="0.001"
              autoFocus
              value={pesoInput}
              onChange={(e) => setPesoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarPesaje();
              }}
            />
          </FormField>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPesaje(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarPesaje} disabled={!pesoInput || Number(pesoInput) <= 0}>
              Agregar al carrito
            </Button>
          </div>
        </Modal>
      ) : null}

      {ventaCompletada ? (
        <Modal
          open
          onClose={nuevaVenta}
          title={`Venta ${ventaCompletada.folio}`}
          icon={Receipt}
          footer={
            <>
              <Button variant="ghost" onClick={() => imprimirTicket(ventaCompletada)}>
                <span className="inline-flex items-center gap-1.5">
                  <Printer className="h-4 w-4" /> Reimprimir ticket
                </span>
              </Button>
              <Button onClick={nuevaVenta}>Nueva venta</Button>
            </>
          }
        >
          {avisoImpresion ? <p role="status" className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{avisoImpresion}</p> : <p className="mb-3 text-sm text-black/60">Se solicitó la impresión del ticket. Puedes reimprimirlo si cancelaste el diálogo.</p>}
          {ventaCompletada.offline ? (
            <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
              Guardada localmente — se sincronizará cuando vuelva la conexión.
            </p>
          ) : null}

          <ul className="mb-3 divide-y divide-black/5 text-sm">
            {ventaCompletada.items.map((i, idx) => (
              <li key={idx} className="flex items-center justify-between py-1.5">
                <span>
                  {i.nombreProducto} × {i.cantidad} {i.unidad}
                </span>
                <span className="font-medium">{formatMoney(i.subtotal)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-black/10 pt-3 text-sm">
            <div className="flex justify-between font-semibold text-titos-green-900">
              <span>Total</span>
              <span>{formatMoney(ventaCompletada.total)}</span>
            </div>
            {ventaCompletada.pagos.map((p, idx) => (
              <div key={idx} className="flex justify-between text-black/50">
                <span>
                  {ETIQUETAS_METODO[p.metodoPago]}
                  {p.tarjetaTipo ? ` — ${ETIQUETA_TIPO_TARJETA[p.tarjetaTipo]}` : ""}
                  {p.montoUsd ? ` — ${p.montoUsd.toFixed(2)} USD` : ""}
                  {p.terminalAlias ? ` — ${p.terminalAlias}` : ""}
                  {p.valeEmisorNombre ? ` — ${p.valeEmisorNombre}` : ""}
                  {p.valeUltimos4 ? ` ****${p.valeUltimos4}` : ""}
                </span>
                <span>{formatMoney(p.monto)}</span>
              </div>
            ))}
            {ventaCompletada.pagos.some((p) => p.metodoPago === "efectivo") ? (
              <>
                <div className="flex justify-between text-black/50">
                  <span>Efectivo recibido</span>
                  <span>{formatMoney(ventaCompletada.montoRecibido ?? 0)}</span>
                </div>
                <div className="flex justify-between text-black/50">
                  <span>Cambio</span>
                  <span>{formatMoney(ventaCompletada.cambio ?? 0)}</span>
                </div>
              </>
            ) : null}
          </div>

          {ventaCompletada.creditoMonto ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">
                {formatMoney(ventaCompletada.creditoMonto)} a crédito de {ventaCompletada.clienteNombre || "el cliente"}
              </p>
              <p className="text-xs">
                Fecha máxima de pago: <strong>{formatFecha(ventaCompletada.creditoFechaVencimiento ?? null, zonaHoraria)}</strong>. Si
                no liquida para esa fecha, se le bloquea el crédito.
              </p>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {cancelacion ? (
        <Modal
          open
          onClose={() => setCancelacion(null)}
          title="Autorizar cancelación"
          icon={ShieldAlert}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCancelacion(null)} disabled={cancelando}>
                Regresar
              </Button>
              <Button variant="danger" onClick={confirmarCancelacion} disabled={cancelando}>
                {cancelando ? "Registrando..." : "Autorizar y cancelar"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-black/70">
            <strong>{cancelacion.titulo}</strong>. Queda registrado en la bitácora de cancelaciones que revisa matriz.
          </p>

          <ul className="mb-4 divide-y divide-black/5 rounded-lg bg-black/2 px-3 text-sm">
            {cancelacion.lineas.map((l) => (
              <li key={l.productoId} className="flex items-center justify-between py-1.5">
                <span className="uppercase">
                  {l.nombre} × {Number(l.cantidad) || 0} {l.unidad}
                </span>
                <span className="font-medium">{formatMoney((Number(l.cantidad) || 0) * l.precioUnitario)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between py-1.5 font-semibold text-titos-green-900">
              <span>Importe cancelado</span>
              <span>
                {formatMoney(
                  cancelacion.lineas.reduce((sum, l) => sum + (Number(l.cantidad) || 0) * l.precioUnitario, 0)
                )}
              </span>
            </li>
          </ul>

          <FormField label="Motivo de la cancelación" className="mb-3">
            <MotivoPosSelector tipo="cancelacion" value={cancelMotivo} onChange={setCancelMotivo} autoFocus />
          </FormField>

          {nipConfigurado ? (
            <FormField label="NIP del encargado de turno">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={cancelNip}
                onChange={(e) => setCancelNip(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarCancelacion();
                }}
                placeholder="••••"
              />
            </FormField>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Todavía no hay ningún NIP configurado, así que la cancelación procede sin autorización pero se marca
              como tal en la bitácora.
            </p>
          )}

          {cancelError ? <p className="mt-3 text-sm text-red-600">{cancelError}</p> : null}
        </Modal>
      ) : null}

      {modalPrecio ? (
        <Modal open onClose={() => setModalPrecio(false)} title="Consultar precio (F2)" icon={Search}>
          <form onSubmit={buscarPrecio} className="mb-4 flex gap-2">
            <Input
              icon={ScanLine}
              autoFocus
              value={precioCodigo}
              onChange={(e) => setPrecioCodigo(e.target.value)}
              placeholder="Escanea o escribe el código del producto"
            />
            <Button type="submit">Buscar</Button>
          </form>
          {precioResultado === undefined ? (
            <p className="text-sm text-black/40">
              Consulta rápida: el producto <strong>no</strong> se agrega al carrito a menos que lo pidas.
            </p>
          ) : precioResultado === null ? (
            <p className="text-sm text-red-600">No se encontró ningún producto con ese código.</p>
          ) : (
            <>
              <div className="rounded-xl bg-titos-green-100 p-4">
                <p className="font-semibold text-titos-green-900">{precioResultado.nombre}</p>
                <p className="mb-2 text-xs text-black/40">SKU: {precioResultado.sku}</p>
                <p className="text-2xl font-bold text-titos-green-900">{formatMoney(precioResultado.precioVenta)}</p>
                {tipoCambio > 0 ? (
                  <p className="text-sm font-semibold text-sky-700">
                    {formatDolares(precioResultado.precioVenta / tipoCambio)} USD
                  </p>
                ) : null}
                <p className="text-xs text-black/50">
                  por {precioResultado.unidad} · Stock disponible:{" "}
                  {inventario.get(precioResultado._id) ?? 0}
                </p>
              </div>

              {/* Cuando el cliente pregunta el precio y dice "sí, dámelo",
                  cerrar el modal y volver a escanear es una vuelta de más. */}
              {sesion ? (
                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-black/10 pt-4">
                  {!precioResultado.requierePesaje ? (
                    <div className="w-28">
                      <label className="mb-1 block text-xs text-black/50">Cantidad</label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={precioCantidad}
                        onChange={(e) => setPrecioCantidad(e.target.value)}
                      />
                    </div>
                  ) : (
                    <p className="flex-1 text-xs text-black/50">
                      Se vende por kilogramo: al agregarlo se pide el peso.
                    </p>
                  )}
                  <Button onClick={agregarDesdeConsulta}>
                    <span className="inline-flex items-center gap-1.5">
                      <PlusCircle className="h-4 w-4" /> Agregar al carrito
                    </span>
                  </Button>
                  <Button variant="ghost" onClick={() => setModalPrecio(false)}>
                    Solo consulta
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Modal>
      ) : null}

      {/* Ayuda de atajos: se abre con el icono (i) de la barra o con Alt+I. */}
      {modalAtajos ? (
        <Modal open onClose={() => setModalAtajos(false)} title="Atajos del punto de venta" icon={Keyboard}>
          <p className="mb-3 text-sm text-black/50">
            Funcionan cuando no hay ninguna ventana abierta. <strong>Esc</strong> cierra la que esté abierta.
          </p>
          <ul className="divide-y divide-black/5">
            {ATAJOS_POS.map((a) => (
              <li key={`${a.teclas}-${a.que}`} className="flex items-start gap-3 py-2">
                <kbd className="min-w-16 shrink-0 rounded-md border border-black/15 bg-black/3 px-2 py-1 text-center font-mono text-xs font-semibold text-black/70">
                  {a.teclas}
                </kbd>
                <span className="text-sm">
                  {a.que}
                  {a.detalle ? <span className="block text-xs text-black/40">{a.detalle}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {modalRetiro ? (
        <Modal open onClose={() => setModalRetiro(false)} title="Retirar efectivo" icon={Banknote}>
          {ultimoRetiro ? (
            <div>
              <p className="mb-3 rounded-xl bg-titos-green-100 px-3 py-2 text-sm font-semibold text-titos-green-800">
                Retiro registrado con folio {ultimoRetiro.folio}
              </p>
              <div className="space-y-1 rounded-xl bg-black/3 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-black/50">Monto</span>
                  <span className="font-semibold">
                    {ultimoRetiro.moneda === "USD" ? formatDolares(ultimoRetiro.monto) : formatMoney(ultimoRetiro.monto)}{" "}
                    {ultimoRetiro.moneda}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Motivo</span>
                  <span className="font-medium">{ultimoRetiro.motivo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Autorizó</span>
                  <span className="font-medium">{ultimoRetiro.usuarioNombre || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Fecha y hora</span>
                  <span className="font-medium">
                    {formatFechaHora(ultimoRetiro.fecha, zonaHoraria)}
                  </span>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModalRetiro(false)}>
                  Cerrar
                </Button>
                <Button onClick={() => imprimirTicketRetiro(ultimoRetiro)}>Imprimir ticket</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-black/50">
                Registra un retiro de efectivo de la caja (por ejemplo, para pagar a un proveedor o resguardar dinero).
                Se genera un folio y queda en el log con fecha y hora.
              </p>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Moneda">
                  <Select value={retiroMoneda} onChange={(e) => setRetiroMoneda(e.target.value as MonedaCaja)}>
                    <option value="MXN">Efectivo (pesos)</option>
                    <option value="USD">Dólares</option>
                  </Select>
                </FormField>
                <FormField label={retiroMoneda === "USD" ? "Monto en dólares" : "Monto en pesos"}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={retiroMonto}
                    onChange={(e) => setRetiroMonto(e.target.value)}
                    placeholder="0.00"
                  />
                </FormField>
              </div>
              <FormField label="Motivo" className="mb-3">
                <Input
                  value={retiroMotivo}
                  onChange={(e) => setRetiroMotivo(e.target.value)}
                  placeholder="Ej. pago a proveedor"
                />
              </FormField>
              {/* Quien saca el dinero es siempre el usuario de la sesión; lo
                  que se elige aquí es quién lo autoriza. El NIP del encargado
                  existe para cuando autoriza en la caja de alguien más sin
                  tener que darle su contraseña al cajero. */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setRetiroConNip(false)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    !retiroConNip ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                  }`}
                >
                  Con mi clave
                </button>
                <button
                  type="button"
                  onClick={() => setRetiroConNip(true)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    retiroConNip ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                  }`}
                >
                  Con NIP del encargado
                </button>
              </div>

              {retiroConNip ? (
                <FormField label="NIP del encargado de turno (6 dígitos)">
                  <Input
                    icon={ShieldAlert}
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={retiroNip}
                    onChange={(e) => setRetiroNip(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !retirando) registrarRetiro();
                    }}
                  />
                  <p className="mt-1 text-xs text-black/40">
                    El retiro queda a nombre de quien lo captura, y en la bitácora aparece quién lo autorizó.
                  </p>
                </FormField>
              ) : (
                <FormField label="Tu clave de acceso">
                  <Input
                    type="password"
                    value={retiroClave}
                    onChange={(e) => setRetiroClave(e.target.value)}
                    placeholder="Confirma tu contraseña para autorizar"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !retirando) registrarRetiro();
                    }}
                  />
                </FormField>
              )}
              {errorRetiro ? <p className="mt-2 text-sm text-red-600">{errorRetiro}</p> : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModalRetiro(false)}>
                  Cancelar
                </Button>
                <Button onClick={registrarRetiro} disabled={retirando}>
                  {retirando ? "Registrando..." : "Registrar retiro"}
                </Button>
              </div>
            </>
          )}
        </Modal>
      ) : null}

      {modalArqueo ? <ArqueoModal onClose={() => setModalArqueo(false)} /> : null}
      {modalCorte ? (
        <Modal open onClose={cerrarModalCorte} title="Nuevo corte de caja" icon={ClipboardCheck} size="lg">
          {corteCerrado ? (
            <div>
              <p className="mb-4 text-sm text-black/50">La caja se cerró correctamente.</p>
              <div className="space-y-1 rounded-xl bg-black/2 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-black/50">Efectivo esperado</span>
                  <span className="font-medium">{formatMoney(corteCerrado.efectivoEsperado)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Efectivo contado</span>
                  <span className="font-medium">{formatMoney(corteCerrado.efectivoContado)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{corteCerrado.diferencia < 0 ? "Faltante" : "Sobrante"}</span>
                  <span className={corteCerrado.diferencia < 0 ? "text-red-600" : "text-titos-green-700"}>
                    {formatMoney(Math.abs(corteCerrado.diferencia))}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-black/10 pt-2">
                  <span className="text-black/50">Dólares esperados / contados</span>
                  <span className="font-medium">
                    {formatDolares(corteCerrado.efectivoEsperadoUsd)} / {formatDolares(corteCerrado.efectivoContadoUsd)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{corteCerrado.diferenciaUsd < 0 ? "Faltante en dólares" : "Sobrante en dólares"}</span>
                  <span className={corteCerrado.diferenciaUsd < 0 ? "text-red-600" : "text-titos-green-700"}>
                    {formatDolares(Math.abs(corteCerrado.diferenciaUsd))}
                  </span>
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <Button onClick={cerrarModalCorte}>Aceptar</Button>
              </div>
            </div>
          ) : !resumenCorte && (!isOnline || errorCorte) ? (
            <div>
              <p className="text-sm text-red-600">{errorCorte || "Necesitas conexión a internet para hacer el corte de caja."}</p>
              <div className="mt-5 flex justify-end">
                <Button variant="ghost" onClick={cerrarModalCorte}>
                  Cerrar
                </Button>
              </div>
            </div>
          ) : cargandoResumen || !resumenCorte ? (
            <p className="text-sm text-black/50">Calculando resumen de caja...</p>
          ) : (
            <div>
              <div className="mb-4 space-y-1 rounded-xl bg-black/2 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-black/50">Ventas registradas</span>
                  <span className="font-medium">{resumenCorte.cantidadVentas}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Efectivo inicial</span>
                  <span className="font-medium">{formatMoney(resumenCorte.sesion.efectivoInicial)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">+ Ventas en efectivo</span>
                  <span className="font-medium">{formatMoney(resumenCorte.totalVentasEfectivo)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">Ventas con tarjeta</span>
                  <span className="font-medium">{formatMoney(resumenCorte.totalVentasTarjeta)}</span>
                </div>
                {/* Crédito, débito y American Express se depositan por separado
                    y con distinta comisión: el corte los tiene que separar. */}
                {(resumenCorte.tarjetaPorTipo ?? []).map((t) => (
                  <div key={t.tipo ?? t.etiqueta} className="flex justify-between pl-4 text-xs">
                    <span className="text-black/40">· {t.etiqueta}</span>
                    <span className="text-black/60">{formatMoney(t.monto)}</span>
                  </div>
                ))}
                {/* Desglose por terminal: es con lo que se cuadra cada depósito del banco. */}
                {(resumenCorte.tarjetaPorTerminal ?? []).map((t) => (
                  <div key={t.terminalId ?? t.alias} className="flex justify-between pl-4 text-xs">
                    <span className="text-black/40">· {t.alias}</span>
                    <span className="text-black/60">{formatMoney(t.monto)}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-black/50">Ventas por transferencia</span>
                  <span className="font-medium">{formatMoney(resumenCorte.totalVentasTransferencia)}</span>
                </div>
                {resumenCorte.totalVentasVales > 0 ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-black/50">Ventas con vales de despensa (no es efectivo)</span>
                      <span className="font-medium">{formatMoney(resumenCorte.totalVentasVales)}</span>
                    </div>
                    {/* Cada emisor se cobra por separado, por eso van desglosados. */}
                    {(resumenCorte.valesPorEmisor ?? []).map((v) => (
                      <div key={v.emisorId ?? v.nombre} className="flex justify-between pl-4 text-xs">
                        <span className="text-black/40">· {v.nombre}</span>
                        <span className="text-black/60">{formatMoney(v.monto)}</span>
                      </div>
                    ))}
                  </>
                ) : null}
                {resumenCorte.totalVentasCredito > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">Ventas a crédito (no es efectivo)</span>
                    <span className="font-medium">{formatMoney(resumenCorte.totalVentasCredito)}</span>
                  </div>
                ) : null}
                {resumenCorte.totalAbonosEfectivo > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">+ Abonos de clientes en efectivo ({resumenCorte.cantidadAbonos})</span>
                    <span className="font-medium">{formatMoney(resumenCorte.totalAbonosEfectivo)}</span>
                  </div>
                ) : null}
                {resumenCorte.totalDevoluciones > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">− Devoluciones pagadas ({resumenCorte.cantidadDevoluciones})</span>
                    <span className="font-medium">{formatMoney(resumenCorte.totalDevoluciones)}</span>
                  </div>
                ) : null}
                {resumenCorte.totalCambioDolaresMxn > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">− Cambio entregado por pagos en dólares</span>
                    <span className="font-medium">{formatMoney(resumenCorte.totalCambioDolaresMxn)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-black/50">− Retiros de efectivo ({resumenCorte.cantidadRetiros})</span>
                  <span className="font-medium">{formatMoney(resumenCorte.totalRetiros)}</span>
                </div>
                <div className="flex justify-between border-t border-black/10 pt-1.5 font-semibold text-titos-green-900">
                  <span>= Efectivo esperado en caja</span>
                  <span>{formatMoney(resumenCorte.efectivoEsperado)}</span>
                </div>
              </div>

              {/* El cajón de dólares se cuadra por separado del de pesos */}
              <div className="mb-4 space-y-1 rounded-xl bg-sky-50 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-black/50">Fondo inicial en dólares</span>
                  <span className="font-medium">{formatDolares(resumenCorte.sesion.efectivoInicialUsd ?? 0)}</span>
                </div>
                {resumenCorte.totalVentasDolaresUsd > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">
                      + Dólares recibidos en ventas
                      <span className="block text-xs text-black/35">
                        Valen {formatMoney(resumenCorte.totalVentasDolaresMxn)} de la venta
                      </span>
                    </span>
                    <span className="font-medium">{formatDolares(resumenCorte.totalVentasDolaresUsd)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-black/50">− Retiros en dólares</span>
                  <span className="font-medium">{formatDolares(resumenCorte.totalRetirosUsd)}</span>
                </div>
                <div className="flex justify-between border-t border-black/10 pt-1.5 font-semibold text-sky-800">
                  <span>= Dólares esperados en caja</span>
                  <span>{formatDolares(resumenCorte.efectivoEsperadoUsd)}</span>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Efectivo contado (pesos)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={efectivoContado}
                    onChange={(e) => setEfectivoContado(e.target.value)}
                    placeholder="0.00"
                  />
                </FormField>
                <FormField label="Dólares contados">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={efectivoContadoUsd}
                    onChange={(e) => setEfectivoContadoUsd(e.target.value)}
                    placeholder="0.00"
                  />
                </FormField>
              </div>

              {efectivoContado ? (
                (() => {
                  const diferencia = Number(efectivoContado) - resumenCorte.efectivoEsperado;
                  return (
                    <p className={`mb-3 text-sm font-semibold ${diferencia < 0 ? "text-red-600" : "text-titos-green-700"}`}>
                      {diferencia < 0 ? "Faltante" : "Sobrante"}: {formatMoney(Math.abs(diferencia))}
                    </p>
                  );
                })()
              ) : null}

              <FormField label="Notas (opcional)" className="mb-3">
                <Input value={notasCorte} onChange={(e) => setNotasCorte(e.target.value)} placeholder="Observaciones del corte" />
              </FormField>

              {errorCorte ? <p className="mb-3 text-sm text-red-600">{errorCorte}</p> : null}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={cerrarModalCorte}>
                  Cancelar
                </Button>
                <Button onClick={confirmarCorte} disabled={cerrandoCaja || !efectivoContado}>
                  {cerrandoCaja ? "Cerrando..." : "Cerrar caja y confirmar corte"}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
