import { obtenerConfiguracionOperacion } from "@/lib/operacion";
import { tienePermiso } from "@/lib/permisos";
import type { SessionPayload } from "@/lib/auth";

// Los traspasos del CEDIS a las tiendas salen sin precios ni totales (minuta
// del 28 de octubre). Se enseñan si la configuración los prende para todos o
// si el rol trae el permiso "pedidos.ver_montos".

export async function puedeVerMontosTraspasos(session: SessionPayload | null) {
  if (!session) return false;
  if (tienePermiso(session, "pedidos.ver_montos")) return true;
  const config = await obtenerConfiguracionOperacion();
  return config.traspasos?.mostrarMontos === true;
}

/** Quita el precio de cada renglón para que la respuesta no lleve montos. */
export function sinMontos<T extends { items?: { precioVenta?: number | null }[] }>(pedido: T): T {
  return { ...pedido, items: (pedido.items ?? []).map((i) => ({ ...i, precioVenta: null })) };
}
