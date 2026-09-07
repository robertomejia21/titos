// Utilidades para que el punto de venta siga funcionando cuando se corta el
// internet a media sesión: guarda catálogo/inventario/caja en localStorage y
// encola las acciones (ventas, apertura de caja, retiros) para sincronizarlas
// en cuanto vuelva la conexión. No sobrevive cerrar la pestaña sin haber
// cargado la app antes con internet — solo cubre la sesión en curso.

const PREFIJO = "titos_pos_";
const PRODUCTOS_KEY = `${PREFIJO}productos_v1`;
const INVENTARIO_KEY = `${PREFIJO}inventario_v1`;
const SESION_KEY = `${PREFIJO}sesion_v1`;
const COLA_KEY = `${PREFIJO}cola_v1`;

function leer<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function escribir<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // almacenamiento lleno o no disponible: se ignora, la app sigue funcionando en memoria
  }
}

export function leerProductosCache<T>(fallback: T): T {
  return leer(PRODUCTOS_KEY, fallback);
}
export function guardarProductosCache<T>(value: T) {
  escribir(PRODUCTOS_KEY, value);
}

export function leerInventarioCache(): Record<string, number> {
  return leer(INVENTARIO_KEY, {});
}
export function guardarInventarioCache(value: Record<string, number>) {
  escribir(INVENTARIO_KEY, value);
}

export function leerSesionCache<T>(): T | null {
  return leer<T | null>(SESION_KEY, null);
}
export function guardarSesionCache<T>(value: T | null) {
  escribir(SESION_KEY, value);
}

// "credito" existe en el tipo porque el mismo payload se manda al servidor,
// pero una venta a crédito nunca se encola: sin conexión no se puede validar el
// límite ni los vencidos del cliente.
export type MetodoPagoOffline =
  | "efectivo"
  | "efectivo_usd"
  | "tarjeta"
  | "transferencia"
  | "vales"
  | "credito";

export type PagoPayload = {
  metodoPago: MetodoPagoOffline;
  monto: number;
  /** Dólares recibidos en billete; solo para "efectivo_usd". */
  montoUsd?: number;
  /** Terminal con la que se cobró; solo para "tarjeta". */
  terminalId?: string;
  /** Crédito, débito o American Express; solo para "tarjeta". */
  tarjetaTipo?: "credito" | "debito" | "amex";
  /** Emisor del vale y últimos 4 de la tarjeta; solo para "vales". */
  valeEmisorId?: string;
  valeUltimos4?: string;
};

export type VentaPayload = {
  /**
   * Identificador de la operación, generado antes del primer envío y estable
   * entre reintentos: es lo que le permite al servidor reconocer una venta que
   * ya registró y no cobrarla dos veces.
   */
  clienteOperacionId: string;
  items: { productoId: string; cantidad: number }[];
  pagos: PagoPayload[];
  montoRecibido?: number;
  clienteId?: string;
};

export type AccionPendiente =
  | { id: string; tipo: "venta"; creadaEn: string; payload: VentaPayload }
  | {
      id: string;
      tipo: "abrir_caja";
      creadaEn: string;
      payload: { clienteOperacionId: string; efectivoInicial: number; efectivoInicialUsd: number };
    }
  // Los retiros ya no se encolan (la clave se valida en el servidor); el tipo se
  // conserva para poder sincronizar los que hayan quedado en cola.
  | { id: string; tipo: "retiro"; creadaEn: string; payload: { monto: number; motivo: string } };

export function leerCola(): AccionPendiente[] {
  return leer(COLA_KEY, []);
}

function guardarCola(cola: AccionPendiente[]) {
  escribir(COLA_KEY, cola);
}

export function agregarACola(accion: AccionPendiente) {
  const cola = [...leerCola(), accion];
  guardarCola(cola);
  return cola;
}

export function quitarDeCola(id: string) {
  const cola = leerCola().filter((a) => a.id !== id);
  guardarCola(cola);
  return cola;
}

export function generarIdLocal() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function generarFolioLocal() {
  return `VTA-LOCAL-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
