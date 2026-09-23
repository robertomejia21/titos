// Búsqueda de productos para la caja del mostrador.
//
// El orden importa y no es estético. Por esa misma casilla entra el escáner de
// código de barras, que teclea el SKU y manda Enter sin que nadie lo vea. Si un
// nombre de producto pudiera ganarle a un SKU exacto, un escaneo terminaría
// cobrando otra cosa. Por eso:
//
//   1. SKU exacto      → es un escaneo, se agrega sin preguntar
//   2. Alias exacto    → el mismo trato: alguien lo registró para esto
//   3. Palabras sueltas → búsqueda por nombre, y si hay varias candidatas NO se
//                         adivina: se le muestran al cajero para que elija
//
// Nunca se elige "la primera" de varias coincidencias. Cobrar el producto
// equivocado es peor que hacer un clic más.

export type ProductoBuscable = {
  _id: string;
  sku: string;
  nombre: string;
  alias?: string[];
};

/** Sin acentos, sin mayúsculas y sin espacios de sobra, para poder comparar. */
export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export type ResultadoBusqueda<T> = {
  /** Coincidencia inequívoca: se puede agregar directo al carrito. */
  exacto: T | null;
  /** Candidatas cuando la consulta no identifica un solo producto. */
  coincidencias: T[];
};

/**
 * Busca un producto por código o por nombre.
 *
 * @param limite Máximo de candidatas a devolver. La caja no tiene espacio para
 *               una lista larga y una lista larga tampoco ayuda a decidir.
 */
export function buscarProducto<T extends ProductoBuscable>(
  productos: T[],
  consulta: string,
  limite = 8,
): ResultadoBusqueda<T> {
  const q = normalizar(consulta);
  if (!q) return { exacto: null, coincidencias: [] };

  const porSku = productos.find((p) => normalizar(p.sku) === q);
  if (porSku) return { exacto: porSku, coincidencias: [] };

  const porAlias = productos.find((p) => p.alias?.some((a) => normalizar(a) === q));
  if (porAlias) return { exacto: porAlias, coincidencias: [] };

  // Todas las palabras tienen que aparecer, en cualquier orden: así "leche
  // entera" encuentra "Leche entera deslactosada 1L" y "entera leche" también.
  const palabras = q.split(" ");
  const candidatas = productos.filter((p) => {
    const texto = normalizar([p.nombre, p.sku, ...(p.alias ?? [])].join(" "));
    return palabras.every((palabra) => texto.includes(palabra));
  });

  // Primero lo que empieza con lo tecleado: quien escribe "coca" espera
  // "Coca Cola" antes que "Galleta sabor coca".
  const ordenadas = [...candidatas].sort((a, b) => {
    const empiezaA = normalizar(a.nombre).startsWith(q) ? 0 : 1;
    const empiezaB = normalizar(b.nombre).startsWith(q) ? 0 : 1;
    if (empiezaA !== empiezaB) return empiezaA - empiezaB;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  // Una sola candidata no es ambigua: se agrega sin hacer elegir.
  if (ordenadas.length === 1) return { exacto: ordenadas[0], coincidencias: [] };

  return { exacto: null, coincidencias: ordenadas.slice(0, limite) };
}
