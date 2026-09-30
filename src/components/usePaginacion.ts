import { useState } from "react";

/** Renglones por página en todas las tablas del sistema. */
export const FILAS_POR_PAGINA = 20;

/**
 * Pagina una lista en el cliente.
 *
 * `clave` es cualquier valor que cambie con los filtros (búsqueda, orden…):
 * cuando cambia se regresa a la página 1 para no quedarse en una página que ya
 * no existe o que no muestra lo recién filtrado.
 */
export function usePaginacion<T>(items: T[], clave?: unknown, pageSize = FILAS_POR_PAGINA) {
  const [page, setPage] = useState(1);
  const [claveAnterior, setClaveAnterior] = useState(clave);
  if (clave !== claveAnterior) {
    setClaveAnterior(clave);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const actual = Math.min(page, totalPages);
  return {
    pagina: items.slice((actual - 1) * pageSize, actual * pageSize),
    /** Props listas para `<Pagination {...paginacion} />`. */
    paginacion: { page: actual, totalPages, totalItems: items.length, pageSize, onChange: setPage },
    /** Índice absoluto del primer renglón de la página (para columnas "#"). */
    desde: (actual - 1) * pageSize,
  };
}
