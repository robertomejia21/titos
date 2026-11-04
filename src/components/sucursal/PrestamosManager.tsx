"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ArrowLeftRight, PackageSearch, Store, Check, X, Truck, Undo2 } from "lucide-react";
import { Button, Card, EmptyState, FormField, Input, Modal } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { SkeletonTabla } from "@/components/Skeleton";

type StockSucursal = { sucursalId: string; nombre: string; stockActual: number };
type ProductoStock = {
  _id: string;
  sku: string;
  nombre: string;
  unidad: string;
  stockPropio: number;
  otrasSucursales: StockSucursal[];
};

type ItemPrestamo = {
  productoId: string;
  sku: string;
  nombreProducto: string;
  unidad: string;
  cantidadSolicitada: number;
  cantidadEntregada: number;
  cantidadDevuelta: number;
};

type Prestamo = {
  _id: string;
  folio: string;
  sucursalSolicitanteId: string;
  sucursalSolicitanteNombre: string;
  sucursalPrestamistaId: string;
  sucursalPrestamistaNombre: string;
  items: ItemPrestamo[];
  estado: "solicitado" | "aprobado" | "recibido" | "devuelto" | "rechazado" | "cancelado";
  notas: string;
  motivoRechazo: string;
  createdAt: string;
};

const ESTADO_ESTILO: Record<Prestamo["estado"], { label: string; className: string }> = {
  solicitado: { label: "Solicitado", className: "bg-sky-100 text-sky-800" },
  aprobado: { label: "Aprobado — por recoger", className: "bg-amber-100 text-amber-800" },
  recibido: { label: "Prestado — por devolver", className: "bg-titos-orange-100 text-titos-orange-700" },
  devuelto: { label: "Devuelto", className: "bg-titos-green-100 text-titos-green-700" },
  rechazado: { label: "Rechazado", className: "bg-red-100 text-red-700" },
  cancelado: { label: "Cancelado", className: "bg-black/5 text-black/50" },
};

function SolicitarModal({
  producto,
  sucursal,
  onClose,
  onSolicitado,
}: {
  producto: ProductoStock;
  sucursal: StockSucursal;
  onClose: () => void;
  onSolicitado: () => void;
}) {
  const [cantidad, setCantidad] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function solicitar() {
    setError(null);
    setEnviando(true);

    const res = await fetch("/api/prestamos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sucursalPrestamistaId: sucursal.sucursalId,
        items: [{ productoId: producto._id, cantidad: Number(cantidad) }],
        notas,
      }),
    });

    setEnviando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo enviar la solicitud");
      return;
    }
    onSolicitado();
  }

  const cantidadNum = Number(cantidad) || 0;

  return (
    <Modal open onClose={onClose} title={`Pedir prestado a ${sucursal.nombre}`} icon={ArrowLeftRight}>
      <div className="mb-4 rounded-xl bg-black/3 p-3 text-sm">
        <p className="font-semibold text-titos-green-900">{producto.nombre}</p>
        <p className="text-black/50">
          {sucursal.nombre} tiene {sucursal.stockActual} {producto.unidad} · tú tienes {producto.stockPropio}
        </p>
      </div>

      <FormField label={`Cantidad a pedir (${producto.unidad})`} className="mb-3">
        <Input
          type="number"
          min="0"
          max={sucursal.stockActual}
          step={producto.unidad === "kg" ? "0.001" : "1"}
          autoFocus
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          placeholder={`máx ${sucursal.stockActual}`}
        />
      </FormField>
      <FormField label="Nota para la otra sucursal">
        <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. lo devuelvo el viernes" />
      </FormField>

      {cantidadNum > sucursal.stockActual ? (
        <p className="mt-2 text-sm text-red-600">Están pidiendo más de lo que esa sucursal tiene disponible.</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={solicitar} disabled={enviando || cantidadNum <= 0 || cantidadNum > sucursal.stockActual}>
          {enviando ? "Enviando..." : "Enviar solicitud"}
        </Button>
      </div>
    </Modal>
  );
}

function CantidadesModal({
  prestamo,
  accion,
  onClose,
  onListo,
}: {
  prestamo: Prestamo;
  accion: "aprobar" | "devolver";
  onClose: () => void;
  onListo: () => void;
}) {
  const maximoDe = useCallback(
    (item: ItemPrestamo) =>
      accion === "aprobar"
        ? item.cantidadSolicitada
        : Number((item.cantidadEntregada - item.cantidadDevuelta).toFixed(3)),
    [accion]
  );

  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(prestamo.items.map((i) => [i.productoId, String(maximoDe(i))]))
  );
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setError(null);
    setEnviando(true);

    const res = await fetch(`/api/prestamos/${prestamo._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion,
        items: prestamo.items.map((i) => ({
          productoId: i.productoId,
          cantidad: Number(cantidades[i.productoId]) || 0,
        })),
      }),
    });

    setEnviando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo completar la acción");
      return;
    }
    onListo();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={accion === "aprobar" ? `Aprobar ${prestamo.folio}` : `Devolver ${prestamo.folio}`}
      icon={accion === "aprobar" ? Check : Undo2}
    >
      <p className="mb-4 text-sm text-black/50">
        {accion === "aprobar"
          ? "Ajusta lo que realmente vas a prestar. El stock sale de tu inventario al aprobar."
          : "Captura lo que estás regresando. Puedes devolver en varias partes."}
      </p>

      <div className="space-y-3">
        {prestamo.items.map((item) => (
          <div key={item.productoId} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{item.nombreProducto}</p>
              <p className="text-xs text-black/40">
                {accion === "aprobar"
                  ? `Solicitado: ${item.cantidadSolicitada} ${item.unidad}`
                  : `Pendiente: ${maximoDe(item)} ${item.unidad}`}
              </p>
            </div>
            <div className="w-32">
              <Input
                type="number"
                min="0"
                max={maximoDe(item)}
                step={item.unidad === "kg" ? "0.001" : "1"}
                value={cantidades[item.productoId] ?? ""}
                onChange={(e) => setCantidades((prev) => ({ ...prev, [item.productoId]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={enviar} disabled={enviando}>
          {enviando ? "Procesando..." : accion === "aprobar" ? "Aprobar préstamo" : "Registrar devolución"}
        </Button>
      </div>
    </Modal>
  );
}

function TarjetaPrestamo({
  prestamo,
  sucursalId,
  onAccion,
  onCantidades,
  procesando,
}: {
  prestamo: Prestamo;
  sucursalId: string;
  onAccion: (id: string, accion: string, extra?: Record<string, unknown>) => void;
  onCantidades: (prestamo: Prestamo, accion: "aprobar" | "devolver") => void;
  procesando: string | null;
}) {
  const zonaHoraria = useZonaHoraria();
  const soySolicitante = prestamo.sucursalSolicitanteId === sucursalId;
  const estilo = ESTADO_ESTILO[prestamo.estado];
  const ocupado = procesando === prestamo._id;

  return (
    <div className="rounded-xl border border-black/10 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-titos-green-900">
            {prestamo.folio}
            <span className="ml-2 font-normal text-sm text-black/50">
              {soySolicitante
                ? `pedido a ${prestamo.sucursalPrestamistaNombre}`
                : `solicitado por ${prestamo.sucursalSolicitanteNombre}`}
            </span>
          </p>
          <p className="text-xs text-black/40">{formatFechaHora(prestamo.createdAt, zonaHoraria)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estilo.className}`}>{estilo.label}</span>
      </div>

      <ul className="mb-3 space-y-0.5 text-sm text-black/70">
        {prestamo.items.map((item) => (
          <li key={item.productoId} className="flex justify-between gap-3">
            <span>{item.nombreProducto}</span>
            <span className="shrink-0 text-black/50">
              {prestamo.estado === "solicitado"
                ? `${item.cantidadSolicitada} ${item.unidad}`
                : `${item.cantidadEntregada} ${item.unidad}${
                    item.cantidadDevuelta > 0 ? ` · devuelto ${item.cantidadDevuelta}` : ""
                  }`}
            </span>
          </li>
        ))}
      </ul>

      {prestamo.notas ? <p className="mb-2 text-xs text-black/50">Nota: {prestamo.notas}</p> : null}
      {prestamo.motivoRechazo ? (
        <p className="mb-2 text-xs text-red-600">Rechazado: {prestamo.motivoRechazo}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!soySolicitante && prestamo.estado === "solicitado" ? (
          <>
            <Button size="sm" onClick={() => onCantidades(prestamo, "aprobar")} disabled={ocupado}>
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> Aprobar
              </span>
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={ocupado}
              onClick={() => {
                const motivo = prompt("Motivo del rechazo (opcional):") ?? "";
                onAccion(prestamo._id, "rechazar", { motivo });
              }}
            >
              <span className="flex items-center gap-1.5">
                <X className="h-3.5 w-3.5" /> Rechazar
              </span>
            </Button>
          </>
        ) : null}

        {soySolicitante && prestamo.estado === "solicitado" ? (
          <Button size="sm" variant="ghost" onClick={() => onAccion(prestamo._id, "cancelar")} disabled={ocupado}>
            Cancelar solicitud
          </Button>
        ) : null}

        {soySolicitante && prestamo.estado === "aprobado" ? (
          <Button size="sm" onClick={() => onAccion(prestamo._id, "recibir")} disabled={ocupado}>
            <span className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Confirmar que ya lo recogí
            </span>
          </Button>
        ) : null}

        {soySolicitante && prestamo.estado === "recibido" ? (
          <Button size="sm" onClick={() => onCantidades(prestamo, "devolver")} disabled={ocupado}>
            <span className="flex items-center gap-1.5">
              <Undo2 className="h-3.5 w-3.5" /> Devolver
            </span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PrestamosManager({ sucursalId }: { sucursalId: string }) {
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [productos, setProductos] = useState<ProductoStock[] | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  const [solicitud, setSolicitud] = useState<{ producto: ProductoStock; sucursal: StockSucursal } | null>(null);
  const [cantidadesModal, setCantidadesModal] = useState<{ prestamo: Prestamo; accion: "aprobar" | "devolver" } | null>(
    null
  );

  const [prestamos, setPrestamos] = useState<Prestamo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/prestamos");
    setCargando(false);
    if (res.ok) setPrestamos(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, [cargar]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (busqueda.trim().length < 2) return;
    setErrorBusqueda(null);
    setBuscando(true);

    const res = await fetch(`/api/prestamos/stock?q=${encodeURIComponent(busqueda.trim())}`);
    setBuscando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorBusqueda(data.error || "No se pudo consultar el stock");
      setProductos(null);
      return;
    }
    const data = await res.json();
    setProductos(data.productos);
  }

  async function ejecutarAccion(id: string, accion: string, extra: Record<string, unknown> = {}) {
    setErrorAccion(null);
    setProcesando(id);

    const res = await fetch(`/api/prestamos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, ...extra }),
    });

    setProcesando(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorAccion(data.error || "No se pudo completar la acción");
      return;
    }
    cargar();
  }

  const porRecibir = useMemo(
    () => prestamos.filter((p) => p.sucursalPrestamistaId === sucursalId && p.estado === "solicitado"),
    [prestamos, sucursalId]
  );
  const mios = useMemo(
    () => prestamos.filter((p) => p.sucursalSolicitanteId === sucursalId),
    [prestamos, sucursalId]
  );
  const prestados = useMemo(
    () => prestamos.filter((p) => p.sucursalPrestamistaId === sucursalId && p.estado !== "solicitado"),
    [prestamos, sucursalId]
  );

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-1 font-semibold text-titos-green-900">Consultar stock en otras sucursales</h2>
        <p className="mb-4 text-sm text-black/50">
          Busca un producto para ver quién tiene existencia y pedirle prestado. El préstamo queda registrado hasta que lo
          devuelvas.
        </p>

        <form onSubmit={buscar} className="mb-4 flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Input
              icon={Search}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre, SKU o alias del producto"
            />
          </div>
          <Button type="submit" disabled={buscando || busqueda.trim().length < 2}>
            {buscando ? "Buscando..." : "Buscar"}
          </Button>
        </form>

        {errorBusqueda ? <p className="text-sm text-red-600">{errorBusqueda}</p> : null}

        {productos !== null ? (
          productos.length === 0 ? (
            <EmptyState message="Ningún producto coincide con la búsqueda." />
          ) : (
            <div className="space-y-3">
              {productos.map((producto) => {
                const conStock = producto.otrasSucursales.filter((s) => s.stockActual > 0);
                return (
                  <div key={producto._id} className="rounded-xl border border-black/10 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-titos-green-900">{producto.nombre}</p>
                        <p className="font-mono text-xs text-black/40">{producto.sku}</p>
                      </div>
                      <span className="flex items-center gap-1.5 rounded-full bg-black/3 px-2.5 py-1 text-xs font-semibold text-black/60">
                        <PackageSearch className="h-3.5 w-3.5" />
                        Tú tienes {producto.stockPropio} {producto.unidad}
                      </span>
                    </div>

                    {conStock.length === 0 ? (
                      <p className="text-sm text-black/40">Ninguna otra sucursal tiene existencia de este producto.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {conStock.map((s) => (
                          <button
                            key={s.sucursalId}
                            type="button"
                            onClick={() => setSolicitud({ producto, sucursal: s })}
                            className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm transition-colors hover:border-titos-green-500 hover:bg-titos-green-100"
                          >
                            <Store className="h-3.5 w-3.5 text-black/40" />
                            <span className="font-medium">{s.nombre}</span>
                            <span className="text-black/50">
                              {s.stockActual} {producto.unidad}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </Card>

      {errorAccion ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{errorAccion}</p>
      ) : null}

      {porRecibir.length > 0 ? (
        <Card className="border-sky-200 bg-sky-50">
          <h2 className="mb-3 font-semibold text-sky-900">
            Te están pidiendo prestado ({porRecibir.length})
          </h2>
          <div className="space-y-3">
            {porRecibir.map((p) => (
              <TarjetaPrestamo
                key={p._id}
                prestamo={p}
                sucursalId={sucursalId}
                onAccion={ejecutarAccion}
                onCantidades={(prestamo, accion) => setCantidadesModal({ prestamo, accion })}
                procesando={procesando}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">Lo que pedí prestado ({mios.length})</h2>
        {cargando ? (
          <SkeletonTabla />
        ) : mios.length === 0 ? (
          <EmptyState message="Todavía no has pedido prestado a otra sucursal." />
        ) : (
          <div className="space-y-3">
            {mios.map((p) => (
              <TarjetaPrestamo
                key={p._id}
                prestamo={p}
                sucursalId={sucursalId}
                onAccion={ejecutarAccion}
                onCantidades={(prestamo, accion) => setCantidadesModal({ prestamo, accion })}
                procesando={procesando}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">Lo que presté ({prestados.length})</h2>
        {prestados.length === 0 ? (
          <EmptyState message="Todavía no le has prestado a otra sucursal." />
        ) : (
          <div className="space-y-3">
            {prestados.map((p) => (
              <TarjetaPrestamo
                key={p._id}
                prestamo={p}
                sucursalId={sucursalId}
                onAccion={ejecutarAccion}
                onCantidades={(prestamo, accion) => setCantidadesModal({ prestamo, accion })}
                procesando={procesando}
              />
            ))}
          </div>
        )}
      </Card>

      {solicitud ? (
        <SolicitarModal
          producto={solicitud.producto}
          sucursal={solicitud.sucursal}
          onClose={() => setSolicitud(null)}
          onSolicitado={() => {
            setSolicitud(null);
            cargar();
          }}
        />
      ) : null}

      {cantidadesModal ? (
        <CantidadesModal
          prestamo={cantidadesModal.prestamo}
          accion={cantidadesModal.accion}
          onClose={() => setCantidadesModal(null)}
          onListo={() => {
            setCantidadesModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
