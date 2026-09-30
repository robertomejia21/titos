"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select, Modal, FormField, EmptyState, Pagination } from "@/components/ui";
import { ProductoCombobox } from "@/components/ProductoCombobox";
import { categoriaLabel } from "@/lib/categorias";

const PAGE_SIZE = 20;

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  alias?: string[];
  categoria: string;
  unidad: "pieza" | "kg";
};

type InventarioProducto = { stockActual: number; stockMinimo: number; stockMaximo: number };

type LineaPedido = { productoId: string; nombre: string; categoria: string; unidad: string; cantidad: string };

type SolicitudNueva = {
  nombreSugerido: string;
  descripcion: string;
  unidad: "pieza" | "kg";
  cantidadSugerida: string;
};

const emptySolicitud: SolicitudNueva = { nombreSugerido: "", descripcion: "", unidad: "pieza", cantidadSugerida: "" };

function SolicitudProductoModal({
  onClose,
  onAgregar,
}: {
  onClose: () => void;
  onAgregar: (solicitud: SolicitudNueva) => void;
}) {
  const [draft, setDraft] = useState<SolicitudNueva>(emptySolicitud);

  function agregar() {
    if (!draft.nombreSugerido || !draft.cantidadSugerida) return;
    onAgregar(draft);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Solicitar producto nuevo">
      <p className="mb-4 text-sm text-black/50">
        Solicita un producto que no está en el catálogo. Matriz lo revisará y generará una orden de compra.
      </p>
      <div className="space-y-3.5">
        <FormField label="Nombre del producto">
          <Input
            autoFocus
            value={draft.nombreSugerido}
            onChange={(e) => setDraft({ ...draft, nombreSugerido: e.target.value })}
          />
        </FormField>
        <FormField label="Descripción (opcional)">
          <Input value={draft.descripcion} onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unidad">
            <Select
              value={draft.unidad}
              onChange={(e) => setDraft({ ...draft, unidad: e.target.value as "pieza" | "kg" })}
            >
              <option value="pieza">Pieza</option>
              <option value="kg">Kilogramo</option>
            </Select>
          </FormField>
          <FormField label="Cantidad sugerida">
            <Input
              type="number"
              min="1"
              value={draft.cantidadSugerida}
              onChange={(e) => setDraft({ ...draft, cantidadSugerida: e.target.value })}
            />
          </FormField>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" disabled={!draft.nombreSugerido || !draft.cantidadSugerida} onClick={agregar}>
          Agregar solicitud
        </Button>
      </div>
    </Modal>
  );
}

export function NuevoPedidoForm() {
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [inventario, setInventario] = useState<Map<string, InventarioProducto>>(new Map());
  const [productoSeleccionado, setProductoSeleccionado] = useState("");
  const [lineas, setLineas] = useState<LineaPedido[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudNueva[]>([]);
  const [modalSolicitudAbierto, setModalSolicitudAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [cargandoResurtido, setCargandoResurtido] = useState(false);
  const [mensajeResurtido, setMensajeResurtido] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/api/productos")
      .then((r) => r.json())
      .then(setProductos);

    fetch("/api/inventario-sucursal")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { productoId: string; stockActual: number; stockMinimo: number; stockMaximo: number }[]) => {
        setInventario(new Map(rows.map((r) => [r.productoId, r])));
      });
  }, []);

  const productosDisponibles = useMemo(
    () => productos.filter((p) => !lineas.some((l) => l.productoId === p._id)),
    [productos, lineas]
  );

  function agregarProducto(productoId: string) {
    const p = productos.find((x) => x._id === productoId);
    if (!p) return;
    setLineas((prev) => [
      ...prev,
      { productoId: p._id, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad, cantidad: "" },
    ]);
    setProductoSeleccionado("");
    setPage(1);
  }

  function actualizarCantidad(productoId: string, cantidad: string) {
    setLineas((prev) => prev.map((l) => (l.productoId === productoId ? { ...l, cantidad } : l)));
  }

  function quitarLinea(productoId: string) {
    setLineas((prev) => prev.filter((l) => l.productoId !== productoId));
  }

  function sugeridoPara(productoId: string): number | null {
    const inv = inventario.get(productoId);
    if (!inv || inv.stockMaximo <= 0) return null;
    return Math.max(0, inv.stockMaximo - inv.stockActual);
  }

  function autocompletarCantidad(productoId: string) {
    const sugerido = sugeridoPara(productoId);
    if (sugerido === null) return;
    actualizarCantidad(productoId, String(sugerido));
  }

  async function cargarSugerenciaResurtido() {
    setMensajeResurtido(null);
    setError(null);
    setCargandoResurtido(true);

    const res = await fetch("/api/inventario-sucursal/resurtido");
    setCargandoResurtido(false);

    if (!res.ok) {
      setError("No se pudo calcular la sugerencia de resurtido");
      return;
    }

    const sugerencias: { productoId: string; nombre: string; categoria: string; unidad: string; cantidadSugerida: number }[] =
      await res.json();

    setLineas((prev) => {
      const yaEnPedido = new Set(prev.map((l) => l.productoId));
      const nuevas = sugerencias
        .filter((s) => !yaEnPedido.has(s.productoId))
        .map((s) => ({
          productoId: s.productoId,
          nombre: s.nombre,
          categoria: s.categoria,
          unidad: s.unidad,
          cantidad: String(s.cantidadSugerida),
        }));
      setMensajeResurtido(
        nuevas.length > 0
          ? `Se agregaron ${nuevas.length} productos en su punto de resurtido. Revisa las cantidades antes de enviar.`
          : "No hay productos en su punto de resurtido en este momento."
      );
      return [...prev, ...nuevas];
    });
    setPage(1);
  }

  function quitarSolicitud(idx: number) {
    setSolicitudes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function enviarPedido() {
    setError(null);

    const items = lineas
      .filter((l) => Number(l.cantidad) > 0)
      .map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad) }));

    if (items.length === 0 && solicitudes.length === 0) {
      setError("Agrega al menos un producto con cantidad, o una solicitud de producto nuevo.");
      return;
    }

    setEnviando(true);
    const res = await fetch("/api/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        solicitudesNuevas: solicitudes.map((s) => ({ ...s, cantidadSugerida: Number(s.cantidadSugerida) })),
      }),
    });

    setEnviando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo enviar el pedido");
      return;
    }

    router.push("/sucursal/pedidos");
    router.refresh();
  }

  const totalPages = Math.max(1, Math.ceil(lineas.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPages);
  const lineasPagina = lineas.slice((paginaActual - 1) * PAGE_SIZE, paginaActual * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-titos-green-900">Agregar productos del catálogo</h2>
          <Button type="button" variant="ghost" onClick={cargarSugerenciaResurtido} disabled={cargandoResurtido}>
            {cargandoResurtido ? "Calculando..." : "Cargar sugerencia de resurtido"}
          </Button>
        </div>
        <ProductoCombobox productos={productosDisponibles} value={productoSeleccionado} onChange={agregarProducto} />
        {mensajeResurtido ? <p className="mt-2 text-sm text-titos-green-700">{mensajeResurtido}</p> : null}

        <div className="mt-4">
          {lineas.length === 0 ? (
            <EmptyState message="Aún no has agregado productos. Búscalos arriba para agregarlos a tu pedido." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Producto</th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Categoría</th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Cantidad a pedir</th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {lineasPagina.map((l) => {
                    const sugerido = sugeridoPara(l.productoId);
                    return (
                      <tr key={l.productoId} className="border-b border-black/5">
                        <td className="max-w-[16rem] truncate px-2 py-1.5 font-medium" title={l.nombre}>{l.nombre}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">{categoriaLabel(l.categoria)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={l.cantidad}
                              onChange={(e) => actualizarCantidad(l.productoId, e.target.value)}
                              className="w-24"
                            />
                            <span className="text-black/40">{l.unidad}</span>
                            {sugerido !== null ? (
                              <button
                                type="button"
                                onClick={() => autocompletarCantidad(l.productoId)}
                                className="whitespace-nowrap text-xs font-medium text-titos-green-700 hover:underline"
                                title="Llenar con la diferencia entre el máximo y tu stock actual"
                              >
                                Usar sugerido ({sugerido})
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          <button onClick={() => quitarLinea(l.productoId)} className="text-xs text-red-500">
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={paginaActual}
            totalPages={totalPages}
            totalItems={lineas.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-black/10 bg-black/1.5 p-4">
        <div>
          <p className="text-sm font-medium text-black/70">¿No encontraste el producto?</p>
          <p className="text-xs text-black/40">Solicítalo y matriz lo revisará para darlo de alta.</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setModalSolicitudAbierto(true)}>
          + Solicitar producto nuevo
        </Button>
      </div>

      {solicitudes.length > 0 ? (
        <Card>
          <h2 className="mb-3 font-semibold text-titos-green-900">Solicitudes de producto nuevo</h2>
          <div className="space-y-2">
            {solicitudes.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-titos-orange-100 p-2 text-sm">
                <span>
                  {s.nombreSugerido} — {s.cantidadSugerida} {s.unidad}
                  {s.descripcion ? ` · ${s.descripcion}` : ""}
                </span>
                <button onClick={() => quitarSolicitud(i)} className="text-red-500">
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div>
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        <Button onClick={enviarPedido} disabled={enviando} className="w-full justify-center sm:w-auto">
          {enviando ? "Enviando..." : "Enviar pedido a la matriz"}
        </Button>
      </div>

      {modalSolicitudAbierto ? (
        <SolicitudProductoModal
          onClose={() => setModalSolicitudAbierto(false)}
          onAgregar={(s) => setSolicitudes((prev) => [...prev, s])}
        />
      ) : null}
    </div>
  );
}
