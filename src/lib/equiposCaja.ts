export const BAUDIOS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const PRUEBAS_EQUIPO = {
  lector: "El lector entrega el código completo una sola vez",
  peso: "El técnico comparó el peso con el visor y revisó cero y tara",
  terminal: "Se revisó con Banorte el procedimiento de cobro y cancelación",
} as const;
export type EquipoCajaConfig = {
  nombreCaja: string; sistemaOperativo: string; marcaBascula: string; modeloBascula: string;
  conexionBascula: string; puerto: string; baudRate: number; dataBits: 7 | 8;
  parity: "none" | "even" | "odd"; stopBits: 1 | 2; flowControl: "none" | "hardware";
  modeloTerminal: string; terminalId: string; banorteIntegracion: string;
  exigirAutorizacion: boolean; notas: string; pruebas: Record<keyof typeof PRUEBAS_EQUIPO, boolean>;
};
export const EQUIPO_VACIO: EquipoCajaConfig = {
  nombreCaja: "", sistemaOperativo: "por_confirmar", marcaBascula: "", modeloBascula: "",
  conexionBascula: "por_confirmar", puerto: "", baudRate: 0, dataBits: 8,
  parity: "none", stopBits: 1, flowControl: "none", modeloTerminal: "", terminalId: "",
  banorteIntegracion: "sin_solicitar", exigirAutorizacion: false, notas: "",
  pruebas: { lector: false, peso: false, terminal: false },
};

export function validarEquipoCaja(valor: unknown): EquipoCajaConfig {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Error("Configuración inválida");
  const v = valor as Record<string, unknown>;
  const texto = (key: string, max: number) => {
    if (typeof v[key] !== "string" || (v[key] as string).trim().length > max) throw new Error(`Revisa el campo ${key}`);
    return (v[key] as string).trim();
  };
  const opcion = <T extends string | number>(key: string, permitidas: readonly T[]): T => {
    if (!permitidas.includes(v[key] as T)) throw new Error(`Elige una opción válida para ${key}`);
    return v[key] as T;
  };
  if (typeof v.exigirAutorizacion !== "boolean") throw new Error("Revisa la regla de autorización");
  const pruebas = v.pruebas as Record<string, unknown> | undefined;
  if (!pruebas || Object.keys(PRUEBAS_EQUIPO).some((k) => typeof pruebas[k] !== "boolean")) throw new Error("Revisa las verificaciones del técnico");
  const config: EquipoCajaConfig = {
    nombreCaja: texto("nombreCaja", 60), sistemaOperativo: opcion("sistemaOperativo", ["por_confirmar", "windows", "macos", "linux"]),
    marcaBascula: texto("marcaBascula", 60), modeloBascula: texto("modeloBascula", 100),
    conexionBascula: opcion("conexionBascula", ["por_confirmar", "rs232", "usb_serial", "opos"]), puerto: texto("puerto", 40),
    baudRate: opcion("baudRate", [0, ...BAUDIOS]), dataBits: opcion("dataBits", [7, 8]), parity: opcion("parity", ["none", "even", "odd"]),
    stopBits: opcion("stopBits", [1, 2]), flowControl: opcion("flowControl", ["none", "hardware"]),
    modeloTerminal: texto("modeloTerminal", 100), terminalId: texto("terminalId", 24),
    banorteIntegracion: opcion("banorteIntegracion", ["sin_solicitar", "solicitada", "documentacion_recibida"]),
    exigirAutorizacion: v.exigirAutorizacion, notas: texto("notas", 1200),
    pruebas: { lector: pruebas.lector as boolean, peso: pruebas.peso as boolean, terminal: pruebas.terminal as boolean },
  };
  if (config.terminalId && !/^[a-f0-9]{24}$/i.test(config.terminalId)) throw new Error("Terminal inválida");
  if (config.exigirAutorizacion && !config.terminalId) throw new Error("Selecciona la terminal de la sucursal antes de exigir la autorización");
  return config;
}

export function pesoEnKg(texto: string, unidad: "kg" | "g" = "kg"): number | null {
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(texto.trim())) return null;
  const valor = Number(texto.replace(",", "."));
  const kg = unidad === "g" ? valor / 1000 : valor;
  if (!Number.isFinite(kg) || kg <= 0 || kg > 100000 || Math.abs(kg * 1000 - Math.round(kg * 1000)) > 0.00001) return null;
  return Math.round(kg * 1000) / 1000;
}

export function autorizacionTarjeta(valor: unknown): string {
  if (valor == null || valor === "") return "";
  if (typeof valor !== "string" || !/^[A-Za-z0-9-]{1,12}$/.test(valor.trim())) throw new Error("La autorización debe tener hasta 12 letras, números o guiones. No captures el número de tarjeta.");
  return valor.trim();
}
