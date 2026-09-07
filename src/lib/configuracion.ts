import Configuracion from "@/models/Configuracion";
import { verifyPassword } from "@/lib/auth";
import {
  buscarSupervisorPorNip,
  hayNipsDeSupervisor,
  type SupervisorAutorizante,
} from "@/lib/supervisores";

/** La configuración es un documento único; se crea sola la primera vez. */
export async function obtenerConfiguracion() {
  let config = await Configuracion.findOne();
  if (!config) config = await Configuracion.create({});
  return config;
}

export const NIP_SUPERVISOR_REGEX = /^\d{4,8}$/;

export type ResultadoNip =
  | {
      ok: true;
      autorizadoConNip: boolean;
      /** Encargado de turno que autorizó, cuando se usó un NIP personal. */
      autorizadoPor?: SupervisorAutorizante | null;
    }
  | { ok: false; error: string };

/**
 * Valida el NIP con el que se autoriza una cancelación.
 *
 * Se aceptan dos NIP y en este orden:
 *  1. El de un encargado de turno (6 dígitos, personal). Es el preferido porque
 *     deja el nombre de quien autorizó en la bitácora.
 *  2. El de la configuración, uno para toda la cadena. Se conserva para las
 *     tiendas que todavía no reparten NIP personales.
 *
 * Si no hay ninguno de los dos configurados, la cancelación procede igual (para
 * no dejar el mostrador sin poder operar) pero queda marcada como no autorizada,
 * que es lo que después se ve en la bitácora.
 */
export async function verificarNipSupervisor(nip: string, sucursalId?: unknown): Promise<ResultadoNip> {
  const config = await obtenerConfiguracion();
  const hashGlobal = config.nipSupervisorHash ?? "";
  const hayPersonales = await hayNipsDeSupervisor(sucursalId);

  if (!hashGlobal && !hayPersonales) return { ok: true, autorizadoConNip: false };
  if (!nip) return { ok: false, error: "Captura el NIP del encargado de turno para autorizar la cancelación" };

  const encargado = await buscarSupervisorPorNip(nip, sucursalId);
  if (encargado) return { ok: true, autorizadoConNip: true, autorizadoPor: encargado };

  if (hashGlobal && (await verifyPassword(nip, hashGlobal))) {
    return { ok: true, autorizadoConNip: true, autorizadoPor: null };
  }

  return { ok: false, error: "NIP incorrecto" };
}

export const NIP_CREACION_SUPERVISOR_REGEX = /^\d{6}$/;

/**
 * Valida el NIP con el que matriz autoriza dar de alta (o ascender a) un
 * supervisor.
 *
 * A diferencia del NIP de cancelaciones, aquí NO se deja pasar cuando todavía
 * no hay ninguno configurado: crear supervisores sin candado es exactamente lo
 * que este NIP viene a impedir, así que sin NIP la operación se bloquea y el
 * error dice dónde configurarlo.
 */
export async function verificarNipCreacionSupervisor(nip: string): Promise<ResultadoNip> {
  const config = await obtenerConfiguracion();
  const hash = config.nipCreacionSupervisorHash ?? "";

  if (!hash) {
    return {
      ok: false,
      error:
        "Todavía no hay NIP de creación de supervisores. Configúralo en Configuración → NIP para crear supervisores " +
        "antes de dar de alta a uno.",
    };
  }
  if (!nip) return { ok: false, error: "Captura el NIP de 6 dígitos para crear un usuario supervisor" };
  if (!NIP_CREACION_SUPERVISOR_REGEX.test(nip)) {
    return { ok: false, error: "El NIP de creación de supervisores es de 6 dígitos" };
  }

  const valido = await verifyPassword(nip, hash);
  if (!valido) return { ok: false, error: "NIP de creación de supervisores incorrecto" };

  return { ok: true, autorizadoConNip: true };
}

// Los topes de los pagos en dólares viven en `lib/dolares` para que el punto de
// venta pueda evaluarlos sin arrastrar mongoose al navegador.
export { motivoRechazoDolares, reglasDolaresDe, topeDolaresEnPesos, type ReglasDolares } from "@/lib/dolares";
