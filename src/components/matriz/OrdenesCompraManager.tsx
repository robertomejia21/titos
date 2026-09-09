"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, EstadoBadge, EmptyState, Input, Select, Modal, FormField, formatMoney } from "@/components/ui";
import { ProductoCombobox } from "@/components/ProductoCombobox";
import { DiferenciaRecepcion } from "@/components/DiferenciaRecepcion";
import { EnviarWhatsAppControl } from "@/components/EnviarWhatsAppControl";
import { imprimirHTML } from "@/lib/print";
import { formatFechaLarga, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
type Necesidad = {
  _id: string;
  productoId: string;
  nombreProducto: string;
  cantidadRequerida: number;
  motivo: "faltante_pedido" | "producto_nuevo" | "manual" | "agotado_venta";
};

type Proveedor = { _id: string; nombre: string; whatsapp?: string };
type Categoria = { _id: string; nombre: string };

type Empleado = { _id: string; nombre: string; puesto: string; whatsapp: string };

type ProductoOpcion = { _id: string; sku: string; nombre: string; unidad: "pieza" | "kg"; precioCompra: number };

type CostoProveedor = { proveedorId: string; nombre: string; costoUnitario: number; esPrincipal: boolean };

async function cargarCostosProveedor(productoId: string): Promise<CostoProveedor[]> {
  const res = await fetch(`/api/productos/${productoId}/proveedores`);
  if (!res.ok) return [];
  const enlaces: {
    proveedorId: { _id: string; nombre: string } | string;
    costoUnitario: number;
    esPrincipal: boolean;
    activo: boolean;
  }[] = await res.json();
  return enlaces
    .filter((e) => e.activo)
    .map((e) => ({
      proveedorId: typeof e.proveedorId === "string" ? e.proveedorId : e.proveedorId._id,
      nombre: typeof e.proveedorId === "string" ? e.proveedorId : e.proveedorId.nombre,
      costoUnitario: e.costoUnitario,
      esPrincipal: e.esPrincipal,
    }));
}

type OrdenItem = {
  productoId: string;
  nombreProducto: string;
  cantidadRequerida: number | null;
  cantidadOrdenada: number;
  precioUnitario: number;
  cantidadRecibida: number | null;
  notaRecepcion?: string;
  necesidadId?: string | null;
};

type EstadoOrden = "borrador" | "solicitada" | "recibida" | "cancelada";

type Orden = {
  _id: string;
  folio: string;
  proveedorId: { _id: string; nombre: string; whatsapp?: string } | string;
  estado: EstadoOrden;
  items: OrdenItem[];
  createdAt: string;
  fechaSolicitud: string | null;
  fechaRecepcion: string | null;
  fechaCancelacion: string | null;
};

type Solicitud = {
  _id: string;
  nombreSugerido: string;
  descripcion: string;
  unidad: "pieza" | "kg";
  cantidadSugerida: number;
  estado: "pendiente" | "convertida";
  sucursalId: { nombre: string } | string;
};

const MOTIVO_LABEL: Record<string, string> = {
  faltante_pedido: "Faltante de pedido",
  producto_nuevo: "Producto nuevo",
  agotado_venta: "Agotado en piso",
  manual: "Agregado manual",
};

function nombreProveedor(orden: Orden) {
  return typeof orden.proveedorId === "string" ? orden.proveedorId : orden.proveedorId.nombre;
}

function whatsappProveedor(orden: Orden) {
  return typeof orden.proveedorId === "string" ? "" : (orden.proveedorId.whatsapp ?? "");
}

// Usa la cantidad recibida cuando ya se registró la recepción (puede ser
// menor o mayor a lo ordenado), para reflejar lo que realmente hay que pagar.
function montoLinea(item: OrdenItem) {
  const cantidad = item.cantidadRecibida ?? item.cantidadOrdenada;
  return cantidad * item.precioUnitario;
}

function totalOrden(orden: Orden) {
  return orden.items.reduce((sum, i) => sum + montoLinea(i), 0);
}

function fechaRelevante(orden: Orden) {
  const fecha = orden.fechaRecepcion ?? orden.fechaCancelacion ?? orden.fechaSolicitud ?? orden.createdAt;
  return formatFechaLarga(fecha, ZONA_HORARIA_DEFAULT);
}

// Texto corto que acompaña al PDF adjunto por WhatsApp (el detalle completo
// va en el documento, no en el mensaje).
function resumenWhatsAppOrden(orden: Orden) {
  return [
    `*Orden de compra ${orden.folio}* — ${nombreProveedor(orden)}`,
    `Fecha: ${fechaRelevante(orden)} · Estado: ${orden.estado}`,
    `Total: ${formatMoney(totalOrden(orden))}`,
    "",
    "Se adjunta el detalle completo en PDF.",
  ].join("\n");
}

function htmlImprimibleOrden(orden: Orden) {
  const filas = orden.items
    .map(
      (i) => `
      <tr>
        <td>${i.nombreProducto}</td>
        <td>${i.cantidadOrdenada}</td>
        <td>${formatMoney(i.precioUnitario)}</td>
        <td>${formatMoney(montoLinea(i))}</td>
      </tr>`
    )
    .join("");

  return `
    <h1>Orden de compra ${orden.folio}</h1>
    <p class="subtitulo">${nombreProveedor(orden)} · estado ${orden.estado}</p>
    <table>
      <thead>
        <tr><th>Producto</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th></tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr><td colspan="2"></td><td>Total</td><td>${formatMoney(totalOrden(orden))}</td></tr>
      </tfoot>
    </table>
  `;
}

function AgregarManualModal({
  productos,
  proveedores,
  onClose,
  onAgregar,
}: {
  productos: ProductoOpcion[];
  proveedores: Proveedor[];
  onClose: () => void;
  onAgregar: (proveedorId: string, productoId: string, cantidad: number) => void;
}) {
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [costos, setCostos] = useState<CostoProveedor[]>([]);

  useEffect(() => {
    if (!productoId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia costos cuando se deselecciona el producto
      setCostos([]);
      return;
    }
    let cancelado = false;
    cargarCostosProveedor(productoId).then((c) => {
      if (cancelado) return;
      setCostos(c);
      const principal = c.find((x) => x.esPrincipal) ?? c[0];
      setProveedorId(principal ? principal.proveedorId : "");
    });
    return () => {
      cancelado = true;
    };
  }, [productoId]);

  return (
    <Modal open onClose={onClose} title="Agregar producto manualmente">
      <div className="space-y-3.5">
        <FormField label="Producto">
          <ProductoCombobox productos={productos} value={productoId} onChange={setProductoId} />
        </FormField>
        <FormField label="Cantidad">
          <Input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </FormField>
        <FormField label="Proveedor">
          <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Selecciona...</option>
            {costos.length > 0
              ? costos.map((c) => (
                  <option key={c.proveedorId} value={c.proveedorId}>
                    {c.nombre} — {formatMoney(c.costoUnitario)}
                    {c.esPrincipal ? " (principal)" : ""}
                  </option>
                ))
              : proveedores.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.nombre}
                  </option>
                ))}
          </Select>
        </FormField>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          variant="secondary"
          disabled={!productoId || !proveedorId || !cantidad}
          onClick={() => onAgregar(proveedorId, productoId, Number(cantidad))}
        >
          Agregar
        </Button>
      </div>
    </Modal>
  );
}

function ConvertirForm({
  solicitud,
  categorias,
  onConvertida,
}: {
  solicitud: Solicitud;
  categorias: Categoria[];
  onConvertida: () => void;
}) {
  const [sku, setSku] = useState("");
  const [categoria, setCategoria] = useState("");
  const [requierePesaje, setRequierePesaje] = useState(solicitud.unidad === "kg");
  const [precioCompra, setPrecioCompra] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/solicitudes-producto/${solicitud._id}/convertir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        categoria,
        requierePesaje,
        precioCompra: Number(precioCompra) || 0,
        precioVenta: Number(precioVenta) || 0,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo convertir la solicitud");
      return;
    }

    onConvertida();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-titos-green-100/40 p-3 sm:grid-cols-2">
      <Input placeholder="SKU nuevo" required value={sku} onChange={(e) => setSku(e.target.value)} />
      <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
        <option value="">Selecciona una categoría</option>
        {categorias.map((c) => (
          <option key={c._id} value={c.nombre}>
            {c.nombre}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        step="0.01"
        placeholder="Precio de compra"
        value={precioCompra}
        onChange={(e) => setPrecioCompra(e.target.value)}
      />
      <Input
        type="number"
        step="0.01"
        placeholder="Precio de venta"
        value={precioVenta}
        onChange={(e) => setPrecioVenta(e.target.value)}
      />
      <label className="col-span-full flex items-center gap-2 text-sm text-black/70">
        <input type="checkbox" checked={requierePesaje} onChange={(e) => setRequierePesaje(e.target.checked)} />
        Requiere pesaje (perecedero)
      </label>
      {error ? <p className="col-span-full text-sm text-red-600">{error}</p> : null}
      <div className="col-span-full">
        <Button type="submit" disabled={saving || !categoria} variant="secondary">
          {saving ? "Creando..." : "Dar de alta producto y generar necesidad de compra"}
        </Button>
      </div>
    </form>
  );
}

function OrdenModal({
  orden,
  productos,
  empleados,
  onClose,
  onUpdated,
}: {
  orden: Orden;
  productos: ProductoOpcion[];
  empleados: Empleado[];
  onClose: () => void;
  onUpdated: (orden: Orden) => void;
}) {
  const [items, setItems] = useState<OrdenItem[]>(orden.items);
  const [nuevoProductoId, setNuevoProductoId] = useState("");
  const [nuevaCantidad, setNuevaCantidad] = useState("");
  const [recepcion, setRecepcion] = useState<Record<string, string>>(() =>
    Object.fromEntries(orden.items.map((i) => [i.productoId, String(i.cantidadOrdenada)]))
  );
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = orden.estado === "borrador";
  const total = items.reduce((sum, i) => sum + montoLinea(i), 0);

  function actualizarItem(productoId: string, campo: "cantidadOrdenada" | "precioUnitario", value: string) {
    setItems((prev) =>
      prev.map((i) => (i.productoId === productoId ? { ...i, [campo]: Number(value) || 0 } : i))
    );
  }

  function quitarItem(productoId: string) {
    setItems((prev) => prev.filter((i) => i.productoId !== productoId));
  }

  function agregarLinea() {
    const producto = productos.find((p) => p._id === nuevoProductoId);
    const cantidad = Number(nuevaCantidad);
    if (!producto || !cantidad || cantidad <= 0) return;
    if (items.some((i) => i.productoId === producto._id)) return;

    setItems((prev) => [
      ...prev,
      {
        productoId: producto._id,
        nombreProducto: producto.nombre,
        cantidadRequerida: null,
        cantidadOrdenada: cantidad,
        precioUnitario: producto.precioCompra ?? 0,
        cantidadRecibida: null,
      },
    ]);
    setNuevoProductoId("");
    setNuevaCantidad("");
  }

  async function guardarCambios() {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/ordenes-compra/${orden._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudieron guardar los cambios");
      return false;
    }

    const actualizado = await res.json();
    onUpdated(actualizado);
    return true;
  }

  async function solicitar() {
    const guardado = await guardarCambios();
    if (!guardado) return;

    const res = await fetch(`/api/ordenes-compra/${orden._id}/solicitar`, { method: "POST" });
    if (res.ok) onUpdated(await res.json());
  }

  async function confirmarRecepcion() {
    setSaving(true);
    setError(null);
    try {
      if (items.some((i) => !recepcion[i.productoId]?.trim())) throw new Error("Captura la cantidad recibida de cada producto; usa cero si no llegó.");
      const res = await fetch(`/api/ordenes-compra/${orden._id}/recibir`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({items: items.map((i) => ({productoId: i.productoId,
          cantidadRecibida: Number(recepcion[i.productoId]), notaRecepcion: notas[i.productoId] ?? ""}))}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo registrar la recepción");
      setItems(data.items);
      onUpdated({...data, proveedorId: orden.proveedorId});
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }

  async function cancelarOrden() {
    const res = await fetch(`/api/ordenes-compra/${orden._id}/cancelar`, { method: "POST" });
    if (res.ok) onUpdated(await res.json());
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${nombreProveedor(orden)} · ${orden.folio}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => imprimirHTML(`Orden ${orden.folio}`, htmlImprimibleOrden(orden))}>
            Imprimir
          </Button>
          {editable ? (
            <>
              <Button variant="ghost" onClick={guardarCambios} disabled={saving || items.length === 0}>
                Guardar cambios
              </Button>
              <Button onClick={solicitar} disabled={saving || items.length === 0}>
                Solicitar al proveedor
              </Button>
            </>
          ) : null}
          {orden.estado === "solicitada" ? <Button onClick={confirmarRecepcion} disabled={saving}>{saving ? "Guardando..." : "Confirmar recepción"}</Button> : null}
          {(orden.estado === "borrador" || orden.estado === "solicitada") && !confirmandoCancelar ? (
            <Button variant="danger" onClick={() => setConfirmandoCancelar(true)}>
              Cancelar orden
            </Button>
          ) : null}
          {confirmandoCancelar ? (
            <>
              <span className="self-center text-sm text-black/60">¿Seguro que quieres cancelar esta orden?</span>
              <Button variant="ghost" onClick={() => setConfirmandoCancelar(false)}>
                No
              </Button>
              <Button variant="danger" onClick={cancelarOrden}>
                Sí, cancelar
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <EstadoBadge estado={orden.estado} />
        <span className="text-xs text-black/40">{fechaRelevante(orden)}</span>
      </div>

      {orden.estado === "solicitada" ? <p className="mb-3 text-sm text-black/70">Captura lo que llegó y anota cualquier diferencia. Confirmar cierra esta recepción; la cantidad ordenada se conserva.</p> : null}
      {error ? <p role="alert" className="mb-2 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/50">
              <th className="py-1.5 pr-2">Producto</th>
              <th className="py-1.5 pr-2">Cantidad</th>
              <th className="py-1.5 pr-2">Precio unit.</th>
              <th className="py-1.5 pr-2">Subtotal</th>
              {orden.estado === "solicitada" ? <th className="py-1.5 pr-2">Recibido</th> : null}
              {orden.estado === "recibida" ? <th className="py-1.5 pr-2">Recibido</th> : null}
              {!editable ? <th className="py-1.5 pr-2">Nota de recepción</th> : null}
              {editable ? <th className="py-1.5 pr-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productoId} className="border-b border-black/5">
                <td className="py-1.5 pr-2 font-medium">{item.nombreProducto}</td>
                <td className="py-1.5 pr-2">
                  {editable ? (
                    <Input
                      type="number"
                      min="1"
                      value={item.cantidadOrdenada}
                      onChange={(e) => actualizarItem(item.productoId, "cantidadOrdenada", e.target.value)}
                      className="w-20"
                    />
                  ) : (
                    item.cantidadOrdenada
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {editable ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.precioUnitario}
                      onChange={(e) => actualizarItem(item.productoId, "precioUnitario", e.target.value)}
                      className="w-24"
                    />
                  ) : (
                    formatMoney(item.precioUnitario)
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {formatMoney(montoLinea(item))}
                  {item.cantidadRecibida !== null && item.cantidadRecibida !== item.cantidadOrdenada ? (
                    <span className="ml-1 text-xs text-amber-600">(ajustado)</span>
                  ) : null}
                </td>
                {orden.estado === "solicitada" ? (
                  <td className="py-1.5 pr-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      aria-label={`Cantidad recibida de ${item.nombreProducto}`}
                      value={recepcion[item.productoId] ?? ""}
                      onChange={(e) => setRecepcion((prev) => ({ ...prev, [item.productoId]: e.target.value }))}
                      className="w-20"
                    />
                    <DiferenciaRecepcion esperado={item.cantidadOrdenada} recibido={recepcion[item.productoId]} referencia="lo ordenado" />
                  </td>
                ) : null}
                {orden.estado === "recibida" ? (
                  <td className="py-1.5 pr-2">
                    {item.cantidadRecibida}
                    <DiferenciaRecepcion esperado={item.cantidadOrdenada} recibido={item.cantidadRecibida} referencia="lo ordenado" />
                  </td>
                ) : null}
                {!editable ? <td className="py-1.5 pr-2">
                  {orden.estado === "solicitada" ? <textarea maxLength={1000}
                    aria-label={`Nota de recepción de ${item.nombreProducto}`}
                    placeholder="Faltante, daño u observación" value={notas[item.productoId] ?? ""}
                    onChange={(e) => setNotas((prev) => ({...prev, [item.productoId]: e.target.value}))}
                    className="min-w-44 rounded border border-black/20 p-2 text-sm focus-visible:outline-2 focus-visible:outline-titos-green-600" />
                    : <span className="whitespace-pre-wrap">{item.notaRecepcion || "—"}</span>}
                </td> : null}
                {editable ? (
                  <td className="py-1.5 pr-2">
                    <button onClick={() => quitarItem(item.productoId)} className="text-xs text-red-500">
                      Quitar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} />
              <td className="pt-2 text-right text-xs font-semibold uppercase text-black/40">Total</td>
              <td className="pt-2 font-semibold text-titos-green-900">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-black/2 p-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-black/50">Agregar otro producto</label>
            <ProductoCombobox productos={productos} value={nuevoProductoId} onChange={setNuevoProductoId} />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs text-black/50">Cantidad</label>
            <Input type="number" min="1" value={nuevaCantidad} onChange={(e) => setNuevaCantidad(e.target.value)} />
          </div>
          <Button type="button" variant="ghost" onClick={agregarLinea} disabled={!nuevoProductoId || !nuevaCantidad}>
            Agregar línea
          </Button>
        </div>
      ) : null}

      <div className="mt-4 border-t border-black/5 pt-4">
        <EnviarWhatsAppControl
          documento={{ tipo: "orden-compra", id: orden._id }}
          caption={resumenWhatsAppOrden(orden)}
          destinatarios={[
            { id: "proveedor", label: `Proveedor: ${nombreProveedor(orden)}`, whatsapp: whatsappProveedor(orden) },
            ...empleados.map((e) => ({
              id: e._id,
              label: `${e.nombre}${e.puesto ? ` (${e.puesto})` : ""}`,
              whatsapp: e.whatsapp,
            })),
          ]}
        />
      </div>
    </Modal>
  );
}

const TABS = [
  { value: "por-ordenar", label: "Por ordenar" },
  { value: "ordenes", label: "Órdenes de compra" },
  { value: "solicitudes", label: "Solicitudes de producto nuevo" },
] as const;

export function OrdenesCompraManager() {
  const searchParams = useSearchParams();
  const tabInicial = TABS.find((t) => t.value === searchParams.get("tab"))?.value ?? "por-ordenar";

  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>(tabInicial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza enlaces del buscador con la pestaña de la URL
    setTab(tabInicial);
  }, [tabInicial]);
  const [necesidades, setNecesidades] = useState<Necesidad[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<ProductoOpcion[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [ordenModal, setOrdenModal] = useState<Orden | null>(null);
  const [manualModalAbierto, setManualModalAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costosPorProducto, setCostosPorProducto] = useState<Map<string, CostoProveedor[]>>(new Map());
  const [seleccion, setSeleccion] = useState<
    Map<string, Partial<{ proveedorId: string; cantidad: string; incluida: boolean }>>
  >(new Map());
  const [generandoOrdenes, setGenerandoOrdenes] = useState(false);
  const [mensajeGenerado, setMensajeGenerado] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    const [necRes, provRes, prodRes, ordRes, solRes, empRes, catRes] = await Promise.all([
      fetch("/api/necesidades-compra?estado=pendiente"),
      fetch("/api/proveedores"),
      fetch("/api/productos"),
      fetch("/api/ordenes-compra"),
      fetch("/api/solicitudes-producto"),
      fetch("/api/empleados"),
      fetch("/api/categorias"),
    ]);
    if (necRes.ok) setNecesidades(await necRes.json());
    if (provRes.ok) setProveedores(await provRes.json());
    if (prodRes.ok) setProductos(await prodRes.json());
    if (ordRes.ok) setOrdenes(await ordRes.json());
    if (solRes.ok) setSolicitudes(await solRes.json());
    if (empRes.ok) setEmpleados(await empRes.json());
    if (catRes.ok) setCategorias(await catRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  // Trae los costos por proveedor de cada producto en "por ordenar" (una vez
  // por producto, se cachean) para sugerir el proveedor más barato por fila.
  useEffect(() => {
    const idsFaltantes = [...new Set(necesidades.map((n) => n.productoId))].filter(
      (id) => !costosPorProducto.has(id)
    );
    if (idsFaltantes.length === 0) return;

    let cancelado = false;
    Promise.all(idsFaltantes.map((id) => cargarCostosProveedor(id).then((c) => [id, c] as const))).then((pares) => {
      if (cancelado) return;
      setCostosPorProducto((prev) => {
        const next = new Map(prev);
        for (const [id, c] of pares) next.set(id, c);
        return next;
      });
    });
    return () => {
      cancelado = true;
    };
  }, [necesidades, costosPorProducto]);

  function costosDe(productoId: string): CostoProveedor[] {
    return costosPorProducto.get(productoId) ?? [];
  }

  function proveedorSugeridoId(productoId: string): string {
    const costos = costosDe(productoId);
    const principal = costos.find((c) => c.esPrincipal) ?? costos[0];
    return principal ? principal.proveedorId : "";
  }

  function proveedorSeleccionado(necesidad: Necesidad): string {
    return seleccion.get(necesidad._id)?.proveedorId ?? proveedorSugeridoId(necesidad.productoId);
  }

  function cantidadSeleccionada(necesidad: Necesidad): string {
    return seleccion.get(necesidad._id)?.cantidad ?? String(necesidad.cantidadRequerida);
  }

  function incluida(necesidad: Necesidad): boolean {
    return seleccion.get(necesidad._id)?.incluida ?? true;
  }

  function actualizarSeleccion(
    necesidadId: string,
    patch: Partial<{ proveedorId: string; cantidad: string; incluida: boolean }>
  ) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      next.set(necesidadId, { ...next.get(necesidadId), ...patch });
      return next;
    });
  }

  async function generarOrdenes() {
    setError(null);
    setMensajeGenerado(null);

    const items = necesidades
      .filter((n) => incluida(n))
      .map((n) => ({
        proveedorId: proveedorSeleccionado(n),
        productoId: n.productoId,
        cantidadOrdenada: Number(cantidadSeleccionada(n)) || 0,
        cantidadRequerida: n.cantidadRequerida,
        necesidadId: n._id,
      }))
      .filter((i) => i.proveedorId && i.cantidadOrdenada > 0);

    if (items.length === 0) {
      setError("Selecciona al menos un producto con proveedor y cantidad válidos");
      return;
    }

    setGenerandoOrdenes(true);
    const res = await fetch("/api/ordenes-compra/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setGenerandoOrdenes(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudieron generar las órdenes de compra");
      return;
    }

    const data: { ordenes: unknown[] } = await res.json();
    setMensajeGenerado(
      `Se generaron/actualizaron ${data.ordenes.length} ${data.ordenes.length === 1 ? "orden" : "órdenes"} de compra.`
    );
    setSeleccion(new Map());
    cargar();
  }

  async function agregarProducto(payload: {
    proveedorId: string;
    productoId: string;
    nombreProducto: string;
    cantidadOrdenada: number;
    cantidadRequerida?: number;
    necesidadId?: string;
  }) {
    setError(null);
    const res = await fetch("/api/ordenes-compra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo agregar el producto a la orden");
      return;
    }

    cargar();
  }

  function agregarManual(proveedorId: string, productoId: string, cantidad: number) {
    const producto = productos.find((p) => p._id === productoId);
    if (!producto) return;

    agregarProducto({
      proveedorId,
      productoId: producto._id,
      nombreProducto: producto.nombre,
      cantidadOrdenada: cantidad,
    });
    setManualModalAbierto(false);
  }

  const ordenesOrdenadas = useMemo(
    () => [...ordenes].sort((a, b) => (a.estado === "borrador" ? -1 : b.estado === "borrador" ? 1 : 0)),
    [ordenes]
  );

  const solicitudesPendientes = solicitudes.filter((s) => s.estado === "pendiente");

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-black/10">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.value ? "border-titos-green-600 text-titos-green-700" : "border-transparent text-black/50"
            }`}
          >
            {t.label}
            {t.value === "por-ordenar" && necesidades.length > 0 ? ` (${necesidades.length})` : ""}
            {t.value === "solicitudes" && solicitudesPendientes.length > 0 ? ` (${solicitudesPendientes.length})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : tab === "por-ordenar" ? (
        <div className="space-y-6">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {mensajeGenerado ? <p className="text-sm text-titos-green-700">{mensajeGenerado}</p> : null}

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-titos-green-900">Necesidades pendientes ({necesidades.length})</h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setManualModalAbierto(true)}>
                  Agregar producto manualmente
                </Button>
                <Button onClick={generarOrdenes} disabled={generandoOrdenes || necesidades.length === 0}>
                  {generandoOrdenes ? "Generando..." : "Generar órdenes de compra"}
                </Button>
              </div>
            </div>
            {necesidades.length === 0 ? (
              <EmptyState message="No hay necesidades de compra pendientes por asignar a un proveedor." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-black/50">
                      <th className="py-2 pr-2" />
                      <th className="py-2 pr-2">Producto</th>
                      <th className="py-2 pr-2">Motivo</th>
                      <th className="py-2 pr-2">Proveedor sugerido</th>
                      <th className="py-2 pr-2">Cantidad a pedir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {necesidades.map((n) => {
                      const costos = costosDe(n.productoId);
                      const proveedorActual = proveedorSeleccionado(n);
                      return (
                        <tr key={n._id} className={`border-b border-black/5 ${!incluida(n) ? "opacity-50" : ""}`}>
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={incluida(n)}
                              onChange={(e) => actualizarSeleccion(n._id, { incluida: e.target.checked })}
                            />
                          </td>
                          <td className="py-2 pr-2 font-medium">{n.nombreProducto}</td>
                          <td className="py-2 pr-2 text-black/60">{MOTIVO_LABEL[n.motivo]}</td>
                          <td className="py-2 pr-2">
                            <Select
                              value={proveedorActual}
                              onChange={(e) => actualizarSeleccion(n._id, { proveedorId: e.target.value })}
                              className="min-w-48"
                            >
                              <option value="">Sin proveedor asignado</option>
                              {costos.length > 0
                                ? costos.map((c) => (
                                    <option key={c.proveedorId} value={c.proveedorId}>
                                      {c.nombre} — {formatMoney(c.costoUnitario)}
                                      {c.esPrincipal ? " (principal)" : ""}
                                    </option>
                                  ))
                                : proveedores.map((p) => (
                                    <option key={p._id} value={p._id}>
                                      {p.nombre}
                                    </option>
                                  ))}
                            </Select>
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              type="number"
                              min="1"
                              value={cantidadSeleccionada(n)}
                              onChange={(e) => actualizarSeleccion(n._id, { cantidad: e.target.value })}
                              className="w-24"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : tab === "ordenes" ? (
        ordenesOrdenadas.length === 0 ? (
          <EmptyState message="Todavía no se ha generado ninguna orden de compra." />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="py-2 pr-2">Proveedor</th>
                    <th className="py-2 pr-2">Folio</th>
                    <th className="py-2 pr-2">Estado</th>
                    <th className="py-2 pr-2">Productos</th>
                    <th className="py-2 pr-2">Total</th>
                    <th className="py-2 pr-2">Fecha</th>
                    <th className="py-2 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {ordenesOrdenadas.map((o) => (
                    <tr key={o._id} className="border-b border-black/5">
                      <td className="py-2 pr-2 font-medium">{nombreProveedor(o)}</td>
                      <td className="py-2 pr-2 text-black/40">{o.folio}</td>
                      <td className="py-2 pr-2">
                        <EstadoBadge estado={o.estado} />
                      </td>
                      <td className="py-2 pr-2 text-black/60">{o.items.length}</td>
                      <td className="py-2 pr-2 font-medium text-titos-green-900">{formatMoney(totalOrden(o))}</td>
                      <td className="py-2 pr-2 text-black/40">{fechaRelevante(o)}</td>
                      <td className="py-2 pr-2">
                        <Button variant="ghost" onClick={() => setOrdenModal(o)}>
                          Ver / Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : solicitudes.length === 0 ? (
        <EmptyState message="No hay solicitudes de producto nuevo." />
      ) : (
        <div className="space-y-3">
          {solicitudes.map((s) => (
            <Card key={s._id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{s.nombreSugerido}</p>
                  <p className="text-xs text-black/40">
                    {typeof s.sucursalId === "string" ? s.sucursalId : s.sucursalId.nombre} · pide {s.cantidadSugerida}{" "}
                    {s.unidad}
                    {s.descripcion ? ` · ${s.descripcion}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <EstadoBadge estado={s.estado} />
                  {s.estado === "pendiente" ? (
                    <Button onClick={() => setAbierta(abierta === s._id ? null : s._id)} variant="ghost">
                      {abierta === s._id ? "Cerrar" : "Convertir"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {abierta === s._id ? (
                <ConvertirForm
                  solicitud={s}
                  categorias={categorias}
                  onConvertida={() => {
                    setAbierta(null);
                    cargar();
                  }}
                />
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {ordenModal ? (
        <OrdenModal
          orden={ordenModal}
          productos={productos}
          empleados={empleados}
          onClose={() => {
            setOrdenModal(null);
            cargar();
          }}
          onUpdated={(actualizado) => {
            setOrdenModal(actualizado);
            setOrdenes((prev) => prev.map((o) => (o._id === actualizado._id ? actualizado : o)));
          }}
        />
      ) : null}

      {manualModalAbierto ? (
        <AgregarManualModal
          productos={productos}
          proveedores={proveedores}
          onClose={() => setManualModalAbierto(false)}
          onAgregar={agregarManual}
        />
      ) : null}
    </div>
  );
}
