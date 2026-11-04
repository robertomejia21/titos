// Esqueletos de carga: bloques grises que laten mientras llegan los datos, para
// que se note que la pantalla está trabajando y no congelada. Respetan
// "reducir movimiento" del sistema (sin animación, solo el gris).

const BLOQUE = "rounded-md bg-black/[0.07] motion-safe:animate-pulse";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`${BLOQUE} ${className}`} />;
}

/** Contenedor accesible: el lector de pantalla anuncia "Cargando…" una vez. */
function Anuncio({ etiqueta, children, className = "" }: { etiqueta: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}

const ANCHOS = ["w-11/12", "w-9/12", "w-10/12", "w-8/12", "w-full", "w-7/12"];

/** Lista o tabla en carga: renglones con columnas de distinto ancho. */
export function SkeletonTabla({ filas = 5, columnas = 4, etiqueta = "Cargando…" }: { filas?: number; columnas?: number; etiqueta?: string }) {
  return (
    <Anuncio etiqueta={etiqueta} className="space-y-3 py-1">
      <div className="flex gap-4">
        {Array.from({ length: columnas }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1 opacity-60" />
        ))}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="flex items-center gap-4">
          {Array.from({ length: columnas }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={`h-4 ${ANCHOS[(f + c) % ANCHOS.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </Anuncio>
  );
}

/** Tarjetas de indicadores en carga. */
export function SkeletonTarjetas({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: cantidad }, (_, i) => (
        <div key={i} className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-3 h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Página completa en carga: encabezado, indicadores y una tabla. Es lo que se
 * ve al navegar mientras el servidor arma la pantalla nueva.
 */
export function SkeletonPagina() {
  return (
    <Anuncio etiqueta="Cargando la página…" className="space-y-6 py-2">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-3 w-96 max-w-full" />
        </div>
      </div>
      <SkeletonTarjetas />
      <div className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
        <div aria-hidden="true">
          <SkeletonFilas />
        </div>
      </div>
    </Anuncio>
  );
}

/** Renglones de tabla sin anuncio propio (para usar dentro de otro esqueleto). */
function SkeletonFilas({ filas = 7, columnas = 5 }: { filas?: number; columnas?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="flex items-center gap-4">
          {Array.from({ length: columnas }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={`h-4 ${ANCHOS[(f + c) % ANCHOS.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
