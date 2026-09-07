import FolioSecuencia from "@/models/FolioSecuencia";

/**
 * Folios consecutivos de ventas: VTA-000001, VTA-000002, ...
 *
 * A diferencia de `generateFolio`, que arma un folio aleatorio irrepetible pero
 * ilegible, este lleva una cuenta real por prefijo. Es lo que el mostrador dicta
 * por teléfono y lo que el cliente ve en su ticket, así que tiene que ser corto.
 */
export const DIGITOS_FOLIO = 6;

/** Formatea un consecutivo con el ancho fijo del folio. */
export function formatearFolio(prefijo: string, consecutivo: number) {
  return `${prefijo}-${String(consecutivo).padStart(DIGITOS_FOLIO, "0")}`;
}

/**
 * Aparta el siguiente folio del prefijo. El `$inc` con upsert es atómico, así
 * que dos ventas simultáneas nunca se llevan el mismo número.
 *
 * Pasadas las 999,999 ventas el folio crece a 7 dígitos en vez de reiniciarse:
 * repetir un folio sería peor que perder el ancho fijo.
 */
export async function siguienteFolio(prefijo: string): Promise<string> {
  const clave = prefijo.toUpperCase();

  // Si dos procesos hacen el upsert a la vez, el índice único deja pasar solo a
  // uno y el otro recibe un duplicado; al reintentar el documento ya existe.
  for (let intento = 0; intento < 3; intento++) {
    try {
      const secuencia = await FolioSecuencia.findOneAndUpdate(
        { prefijo: clave },
        { $inc: { consecutivo: 1 } },
        { new: true, upsert: true }
      );
      return formatearFolio(clave, secuencia.consecutivo);
    } catch (err) {
      const codigo = (err as { code?: number }).code;
      if (codigo !== 11000 || intento === 2) throw err;
    }
  }

  throw new Error(`No se pudo apartar el folio de ${clave}`);
}

/** Prefijos con los que se emiten folios de venta (ventas normales y notas de venta). */
export const PREFIJOS_FOLIO_VENTA = ["VTA", "V2"] as const;

/**
 * Folios candidatos a partir de lo que se teclea al buscar una venta.
 *
 * En el mostrador nadie escribe "VTA-000123": dictan "el ciento veintitrés". Se
 * aceptan las tres formas —el folio completo, el número pelón y el número con
 * ceros— y se arman los candidatos con los dos prefijos de venta.
 *
 * Devuelve una lista de folios exactos, no un patrón: buscar por "contiene"
 * haría que el 123 trajera también el 1234 y el 5123.
 */
export function candidatosFolioVenta(entrada: string): string[] {
  const limpio = (entrada ?? "").trim().toUpperCase();
  if (!limpio) return [];

  // Ya viene con prefijo, en cualquiera de sus formas ("VTA-123", "VTA 123",
  // "vta123"): se separa el prefijo de los dígitos y se reconstruye.
  const conPrefijo = limpio.match(/^([A-Z]+)[\s-]*(\d+)$/);
  if (conPrefijo) {
    const [, prefijo, digitos] = conPrefijo;
    return [formatearFolio(prefijo, Number(digitos)), `${prefijo}-${digitos}`];
  }

  // Solo dígitos: se prueban los dos prefijos de venta, con y sin relleno de
  // ceros (los folios viejos pudieron guardarse con otro ancho).
  if (/^\d+$/.test(limpio)) {
    const numero = Number(limpio);
    return [
      ...PREFIJOS_FOLIO_VENTA.map((p) => formatearFolio(p, numero)),
      ...PREFIJOS_FOLIO_VENTA.map((p) => `${p}-${limpio}`),
      limpio,
    ];
  }

  // Cualquier otra cosa (un folio local "VTA-LOCAL-ABC123", por ejemplo) se
  // busca tal cual.
  return [limpio];
}
