import { randomBytes } from "node:crypto";
import ConfiguracionOperacion from "@/models/ConfiguracionOperacion";
import { obtenerMostradorMatriz } from "@/lib/puntoVenta";
import { fechaEnZona, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

/** Documento único con las reglas de operación del CEDIS; se crea solo la primera vez. */
export async function obtenerConfiguracionOperacion() {
  let config = await ConfiguracionOperacion.findOne();
  if (!config) config = await ConfiguracionOperacion.create({ pantallaToken: nuevoTokenPantalla() });
  if (!config.pantallaToken) {
    config.pantallaToken = nuevoTokenPantalla();
    await config.save();
  }
  return config;
}

export function nuevoTokenPantalla() {
  return randomBytes(18).toString("base64url");
}

/** sucursalId → prioridad (1 = primero). */
export function mapaPrioridades(config: { prioridadSucursales?: { sucursalId: unknown; prioridad: number }[] | null }) {
  return new Map((config.prioridadSucursales ?? []).map((p) => [String(p.sucursalId), p.prioridad]));
}

/** El CEDIS opera en la zona horaria de su mostrador. */
export async function zonaCedis() {
  const mostrador = await obtenerMostradorMatriz();
  return mostrador?.zonaHoraria || ZONA_HORARIA_DEFAULT;
}

export async function hoyCedis() {
  return fechaEnZona(new Date(), await zonaCedis());
}
