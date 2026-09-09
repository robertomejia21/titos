"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { Button, Card, EstadoBadge, EmptyState, Input, Select, Modal, formatMoney } from "@/components/ui";
import { EnviarWhatsAppControl } from "@/components/EnviarWhatsAppControl";
import { imprimirHTML } from "@/lib/print";
import { fechaEnZona, formatFechaHora, sumarDias, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { categoriaLabel } from "@/lib/categorias";
import { montoLineaPedido } from "@/lib/montoPedido";

// Frutas y verduras y carnicería se surten directo, sin empacar en cajas selladas.
const CATEGORIAS_SIN_CAJAS = ["frutas_verduras", "carniceria"];

type Empleado = { _id: string; nombre: string; puesto: string; whatsapp: string };

type Item = {
  productoId: string;
  nombreProducto: string;
  categoria: string;
  unidad: "pieza" | "kg";
  requierePesaje: boolean;
  precioVenta: number;
  cantidadPedida: number;
  cantidadAsignada: number | null;
  cantidadSurtida: number | null;
  pesoSurtidoKg: number | null;
  cantidadRecibida: number | null;
  notaRecepcion?: string;
  pesoRecibidoKg: number | null;
};

type CajaItem = { productoId: string; nombreProducto: string; cantidad: number };
type Caja = { numero: string; cincho1: string; cincho2: string; categoria: string; items: CajaItem[] };

type Pedido = {
  _id: string;
  folio: string;
  estado: "pendiente" | "nivelado" | "surtido" | "recibido";
  corte: string;
  fecha: string;
  sucursalId: { _id: string; nombre: string; whatsapp?: string } | string;
  repartidorId: { _id: string; nombre: string; whatsapp?: string } | string | null;
  items: Item[];
  cajas: Caja[];
  surtidoEn?: string | null;
  surtidoPorId?: { _id: string; nombre: string } | string | null;
  recibidoEn?: string | null;
  recibidoPorId?: { _id: string; nombre: string } | string | null;
};

function repartidorDe(pedido: Pedido) {
  return pedido.repartidorId && typeof pedido.repartidorId !== "string" ? pedido.repartidorId : null;
}

/** Viene poblado con el nombre; si quedó como string, el usuario ya no existe. */
function nombreUsuario(valor: Pedido["surtidoPorId"]) {
  return valor && typeof valor !== "string" ? valor.nombre : null;
}

const TABS = [
  { value: "pendiente", label: "Pendientes" },
  { value: "nivelado", label: "Nivelados (listos para surtir)" },
  { value: "historial", label: "Historial" },
] as const;

function categoriaDe(item: Item) {
  return item.categoria || "otros";
}

function nombreSucursal(pedido: Pedido) {
  return typeof pedido.sucursalId === "string" ? pedido.sucursalId : pedido.sucursalId.nombre;
}

function whatsappSucursal(pedido: Pedido) {
  return typeof pedido.sucursalId === "string" ? "" : (pedido.sucursalId.whatsapp ?? "");
}

function totalPedido(pedido: Pedido) {
  return pedido.items.reduce((sum, i) => sum + montoLineaPedido(i), 0);
}

// Texto corto que acompaña al PDF adjunto por WhatsApp (el detalle completo
// va en el documento, no en el mensaje).
function resumenWhatsAppPedido(pedido: Pedido) {
  const repartidor = repartidorDe(pedido);

  return [
    `*Pedido ${pedido.folio}* — ${nombreSucursal(pedido)}`,
    `Corte: ${pedido.corte} · Estado: ${pedido.estado}`,
    ...(repartidor ? [`Repartidor: ${repartidor.nombre}`] : []),
    `Total: ${formatMoney(totalPedido(pedido))}`,
    "",
    "Se adjunta el detalle completo en PDF.",
  ].join("\n");
}

function htmlImprimiblePedido(pedido: Pedido) {
  const filas = pedido.items
    .map(
      (i) => `
      <tr>
        <td>${i.nombreProducto}${i.requierePesaje ? " (pesaje)" : ""}</td>
        <td>${i.cantidadPedida} ${i.unidad}</td>
        <td>${i.cantidadAsignada ?? "—"}</td>
        <td>${i.cantidadSurtida ?? "—"}${i.pesoSurtidoKg ? ` (${i.pesoSurtidoKg} kg)` : ""}</td>
        <td>${formatMoney(i.precioVenta)}</td>
        <td>${formatMoney(montoLineaPedido(i))}</td>
      </tr>`
    )
    .join("");

  const filasCajas = pedido.cajas
    .map(
      (c) => `
      <tr>
        <td>Caja ${c.numero}</td>
        <td>${categoriaLabel(c.categoria)}</td>
        <td>${c.items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", ")}</td>
        <td>${c.cincho1} / ${c.cincho2}</td>
      </tr>`
    )
    .join("");

  const repartidor = repartidorDe(pedido);

  return `
    <h1>Pedido ${pedido.folio}</h1>
    <p class="subtitulo">${nombreSucursal(pedido)} · corte ${pedido.corte} · estado ${pedido.estado}${
      repartidor ? ` · repartidor: ${repartidor.nombre}` : ""
    }</p>
    <table>
      <thead>
        <tr><th>Producto</th><th>Pedido</th><th>Nivelado</th><th>Surtido</th><th>Precio venta</th><th>Subtotal</th></tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr><td colspan="4"></td><td>Total</td><td>${formatMoney(totalPedido(pedido))}</td></tr>
      </tfoot>
    </table>
    ${
      pedido.cajas.length > 0
        ? `<h1 style="margin-top:20px;font-size:16px;">Cajas selladas</h1>
      <table>
        <thead><tr><th>Caja</th><th>Categoría</th><th>Contenido</th><th>Cinchos</th></tr></thead>
        <tbody>${filasCajas}</tbody>
      </table>`
        : ""
    }
  `;
}

function CajasCategoria({
  pedido,
  categoria,
  editable,
  onActualizado,
}: {
  pedido: Pedido;
  categoria: string;
  editable: boolean;
  onActualizado: (pedido: Pedido) => void;
}) {
  const itemsCategoria = pedido.items.filter((i) => categoriaDe(i) === categoria);
  const cajasCategoria = pedido.cajas.filter((c) => c.categoria === categoria);

  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [numeroCaja, setNumeroCaja] = useState("");
  const [cincho1, setCincho1] = useState("");
  const [cincho2, setCincho2] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function alternarProducto(item: Item) {
    setSeleccion((prev) => {
      const copia = { ...prev };
      if (item.productoId in copia) {
        delete copia[item.productoId];
      } else {
        copia[item.productoId] = String(item.cantidadSurtida ?? item.cantidadAsignada ?? "");
      }
      return copia;
    });
  }

  async function agregarCaja() {
    setError(null);
    const items = Object.entries(seleccion)
      .filter(([, cant]) => Number(cant) > 0)
      .map(([productoId, cant]) => {
        const item = itemsCategoria.find((i) => i.productoId === productoId)!;
        return { productoId, nombreProducto: item.nombreProducto, cantidad: Number(cant) };
      });

    if (items.length === 0 || !numeroCaja || !cincho1 || !cincho2) {
      setError("Captura el número de caja, selecciona al menos un producto y los dos números de cincho");
      return;
    }

    setGuardando(true);
    const res = await fetch(`/api/pedidos/${pedido._id}/cajas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: numeroCaja, cincho1, cincho2, categoria, items }),
    });
    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar la caja");
      return;
    }

    onActualizado(await res.json());
    setSeleccion({});
    setNumeroCaja("");
    setCincho1("");
    setCincho2("");
  }

  async function quitarCaja(numero: string) {
    const res = await fetch(`/api/pedidos/${pedido._id}/cajas/${encodeURIComponent(numero)}`, { method: "DELETE" });
    if (res.ok) onActualizado(await res.json());
  }

  return (
    <div className="mt-4 rounded-lg border border-black/5 p-3">
      <p className="mb-2 text-sm font-semibold text-titos-green-900">Cajas selladas</p>

      {cajasCategoria.length === 0 ? (
        <p className="mb-2 text-xs text-black/40">Todavía no se ha registrado ninguna caja de esta categoría.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {cajasCategoria.map((c) => (
            <li key={c.numero} className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/2 px-2 py-1.5 text-xs">
              <span>
                <span className="font-semibold">Caja {c.numero}</span> — {c.items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", ")}
                {" · "}
                cinchos <span className="font-mono">{c.cincho1}</span> / <span className="font-mono">{c.cincho2}</span>
              </span>
              {editable ? (
                <button onClick={() => quitarCaja(c.numero)} className="text-red-500">
                  Quitar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <div className="rounded-lg bg-black/2 p-3">
          <p className="mb-1.5 text-xs font-medium text-black/50">Nueva caja: selecciona qué lleva y séllala</p>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {itemsCategoria.map((item) => (
              <label key={item.productoId} className="flex items-center gap-1.5 text-sm text-black/70">
                <input
                  type="checkbox"
                  checked={item.productoId in seleccion}
                  onChange={() => alternarProducto(item)}
                />
                {item.nombreProducto}
                {item.productoId in seleccion ? (
                  <Input
                    type="number"
                    min="1"
                    value={seleccion[item.productoId]}
                    onChange={(e) => setSeleccion((prev) => ({ ...prev, [item.productoId]: e.target.value }))}
                    className="w-16 py-1"
                  />
                ) : null}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <label className="mb-1 block text-xs text-black/50">Número de caja</label>
              <Input value={numeroCaja} onChange={(e) => setNumeroCaja(e.target.value)} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs text-black/50">Cincho 1</label>
              <Input value={cincho1} onChange={(e) => setCincho1(e.target.value)} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs text-black/50">Cincho 2</label>
              <Input value={cincho2} onChange={(e) => setCincho2(e.target.value)} />
            </div>
            <Button type="button" variant="ghost" onClick={agregarCaja} disabled={guardando}>
              {guardando ? "Guardando..." : "Agregar caja"}
            </Button>
          </div>
          {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PedidoModal({
  pedido: pedidoInicial,
  empleados,
  onClose,
  onRefrescar,
}: {
  pedido: Pedido;
  empleados: Empleado[];
  onClose: () => void;
  onRefrescar: () => void;
}) {
  const zonaHoraria = useZonaHoraria();
  const [pedido, setPedido] = useState(pedidoInicial);
  const editable = pedido.estado === "nivelado";

  const categorias = useMemo(
    () => Array.from(new Set(pedido.items.map(categoriaDe))),
    [pedido.items]
  );
  const [tabActiva, setTabActiva] = useState(categorias[0] ?? "");

  const [valores, setValores] = useState<Record<string, { cantidad: string; peso: string }>>(() =>
    Object.fromEntries(
      pedido.items.map((i) => [
        i.productoId,
        {
          cantidad: String(i.cantidadSurtida ?? i.cantidadAsignada ?? 0),
          peso: i.pesoSurtidoKg != null ? String(i.pesoSurtidoKg) : "",
        },
      ])
    )
  );
  const [guardandoCategoria, setGuardandoCategoria] = useState<string | null>(null);
  const [asignandoRepartidor, setAsignandoRepartidor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repartidores = useMemo(() => empleados.filter((e) => e.puesto === "Repartidor"), [empleados]);
  const repartidorAsignado = repartidorDe(pedido);

  async function asignarRepartidor(repartidorId: string) {
    setAsignandoRepartidor(true);
    const res = await fetch(`/api/pedidos/${pedido._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repartidorId: repartidorId || null }),
    });
    setAsignandoRepartidor(false);
    if (res.ok) setPedido(await res.json());
  }

  function actualizar(productoId: string, campo: "cantidad" | "peso", value: string) {
    setValores((prev) => ({
      ...prev,
      [productoId]: { ...prev[productoId], [campo]: value },
    }));
  }

  function itemsDeCategoria(cat: string) {
    return pedido.items.filter((i) => categoriaDe(i) === cat);
  }

  function categoriaCompleta(cat: string) {
    return itemsDeCategoria(cat).every((i) => i.cantidadSurtida !== null && i.cantidadSurtida !== undefined);
  }

  async function guardarCategoria(cat: string) {
    setError(null);
    setGuardandoCategoria(cat);

    const items = itemsDeCategoria(cat).map((item) => ({
      productoId: item.productoId,
      cantidadSurtida: Number(valores[item.productoId]?.cantidad) || 0,
      pesoSurtidoKg: valores[item.productoId]?.peso ? Number(valores[item.productoId].peso) : undefined,
    }));

    const res = await fetch(`/api/pedidos/${pedido._id}/surtir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    setGuardandoCategoria(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar esta categoría");
      return;
    }

    const data = await res.json();
    setPedido(data.pedido);
    onRefrescar();
  }

  const total = pedido.items.reduce((sum, i) => sum + montoLineaPedido(i), 0);
  const completadas = categorias.filter(categoriaCompleta).length;

  return (
    <Modal
      open
      onClose={() => {
        onRefrescar();
        onClose();
      }}
      title={`${nombreSucursal(pedido)} · ${pedido.folio}`}
      footer={
        <Button variant="ghost" onClick={() => imprimirHTML(`Pedido ${pedido.folio}`, htmlImprimiblePedido(pedido))}>
          Imprimir
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <EstadoBadge estado={pedido.estado} />
        <span className="text-xs text-black/40">corte {pedido.corte}</span>
        {editable ? (
          <span className="text-xs text-black/40">
            · {completadas}/{categorias.length} categorías guardadas
          </span>
        ) : null}
      </div>

      {/* Trazabilidad del pedido: quién lo surtió y quién confirmó que llegó.
          Es lo mismo que reporta la bitácora, a la mano de quien abre el pedido. */}
      {pedido.surtidoEn || pedido.recibidoEn ? (
        <div className="mb-3 space-y-0.5 rounded-lg bg-black/3 px-3 py-2 text-xs text-black/60">
          {pedido.surtidoEn ? (
            <p>
              Surtió <strong>{nombreUsuario(pedido.surtidoPorId) ?? "—"}</strong> el{" "}
              {formatFechaHora(pedido.surtidoEn, zonaHoraria)}
            </p>
          ) : null}
          {pedido.recibidoEn ? (
            <p>
              Recibió <strong>{nombreUsuario(pedido.recibidoPorId) ?? "—"}</strong> el{" "}
              {formatFechaHora(pedido.recibidoEn, zonaHoraria)}
            </p>
          ) : null}
        </div>
      ) : null}

      {pedido.estado !== "pendiente" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-black/50">Repartidor asignado:</label>
          {pedido.estado === "recibido" ? (
            <span className="text-sm text-black/70">{repartidorAsignado?.nombre ?? "— Sin asignar —"}</span>
          ) : (
            <Select
              value={repartidorAsignado?._id ?? ""}
              onChange={(e) => asignarRepartidor(e.target.value)}
              disabled={asignandoRepartidor}
              className="w-56"
            >
              <option value="">— Sin asignar —</option>
              {repartidores.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.nombre}
                </option>
              ))}
            </Select>
          )}
          {repartidores.length === 0 ? (
            <span className="text-xs text-black/40">No hay repartidores dados de alta en Personal.</span>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

      {categorias.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1 border-b border-black/10">
          {categorias.map((cat) => (
            <button
              key={cat}
              onClick={() => setTabActiva(cat)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
                tabActiva === cat ? "border-titos-green-600 text-titos-green-700" : "border-transparent text-black/50"
              }`}
            >
              {categoriaCompleta(cat) ? (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-titos-green-600 text-white">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
              {categoriaLabel(cat)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-black/50">
              <th className="py-1.5 pr-2">Producto</th>
              <th className="py-1.5 pr-2">Pedido</th>
              {pedido.estado !== "pendiente" ? <th className="py-1.5 pr-2">Nivelado</th> : null}
              <th className="py-1.5 pr-2">Precio venta</th>
              {editable ? <th className="py-1.5 pr-2">Surtir cantidad</th> : null}
              {editable ? <th className="py-1.5 pr-2">Peso (kg)</th> : null}
              {!editable && pedido.estado !== "pendiente" ? <th className="py-1.5 pr-2">Surtido</th> : null}
              {pedido.estado === "recibido" ? <th className="py-1.5 pr-2">Recibido</th> : null}
              <th className="py-1.5 pr-2">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {itemsDeCategoria(tabActiva).map((item) => (
              <tr key={item.productoId} className="border-b border-black/5">
                <td className="py-1.5 pr-2 font-medium">
                  {item.nombreProducto}
                  {item.notaRecepcion ? <p className="mt-1 whitespace-pre-wrap text-xs font-normal text-black/70">Nota de recepción: {item.notaRecepcion}</p> : null}
                  {item.requierePesaje ? <span className="ml-1 text-xs text-titos-orange-600">(pesaje)</span> : null}
                </td>
                <td className="py-1.5 pr-2">
                  {item.cantidadPedida} {item.unidad}
                </td>
                {pedido.estado !== "pendiente" ? (
                  <td className="py-1.5 pr-2">
                    {item.cantidadAsignada}
                    {item.cantidadAsignada !== item.cantidadPedida ? (
                      <span className="ml-1 text-xs text-amber-600">(nivelado)</span>
                    ) : null}
                  </td>
                ) : null}
                <td className="py-1.5 pr-2">{formatMoney(item.precioVenta)}</td>
                {editable ? (
                  <td className="py-1.5 pr-2">
                    <Input
                      type="number"
                      min="0"
                      value={valores[item.productoId]?.cantidad ?? ""}
                      onChange={(e) => actualizar(item.productoId, "cantidad", e.target.value)}
                      className="w-20"
                    />
                  </td>
                ) : null}
                {editable ? (
                  <td className="py-1.5 pr-2">
                    {item.requierePesaje ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="kg"
                        value={valores[item.productoId]?.peso ?? ""}
                        onChange={(e) => actualizar(item.productoId, "peso", e.target.value)}
                        className="w-20"
                      />
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                ) : null}
                {!editable && pedido.estado !== "pendiente" ? (
                  <td className="py-1.5 pr-2">
                    {item.cantidadSurtida}
                    {item.pesoSurtidoKg ? ` (${item.pesoSurtidoKg} kg)` : ""}
                  </td>
                ) : null}
                {pedido.estado === "recibido" ? (
                  <td className="py-1.5 pr-2">
                    {item.cantidadRecibida}
                    {item.pesoRecibidoKg ? ` (${item.pesoRecibidoKg} kg)` : ""}
                  </td>
                ) : null}
                <td className="py-1.5 pr-2 font-medium">{formatMoney(montoLineaPedido(item))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={pedido.estado === "pendiente" ? 3 : 4} />
              <td className="pt-2 text-right text-xs font-semibold uppercase text-black/40">Total del pedido</td>
              <td className="pt-2 font-semibold text-titos-green-900">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable ? (
        <div className="mt-3 flex justify-end">
          <Button onClick={() => guardarCategoria(tabActiva)} disabled={guardandoCategoria === tabActiva} variant="secondary">
            {guardandoCategoria === tabActiva
              ? "Guardando..."
              : `Guardar ${categoriaLabel(tabActiva)}${categoriaCompleta(tabActiva) ? " ✓" : ""}`}
          </Button>
        </div>
      ) : null}

      {tabActiva && !CATEGORIAS_SIN_CAJAS.includes(tabActiva) ? (
        <CajasCategoria pedido={pedido} categoria={tabActiva} editable={editable} onActualizado={setPedido} />
      ) : null}

      <div className="mt-4 border-t border-black/5 pt-4">
        <EnviarWhatsAppControl
          documento={{ tipo: "pedido", id: pedido._id }}
          caption={resumenWhatsAppPedido(pedido)}
          destinatarios={[
            { id: "sucursal", label: `Sucursal: ${nombreSucursal(pedido)}`, whatsapp: whatsappSucursal(pedido) },
            ...(repartidorAsignado
              ? [{ id: repartidorAsignado._id, label: `Repartidor: ${repartidorAsignado.nombre}`, whatsapp: repartidorAsignado.whatsapp ?? "" }]
              : []),
          ]}
        />
        {!repartidorAsignado ? (
          <p className="mt-1.5 text-xs text-black/40">Asigna un repartidor arriba para poder enviarle el pedido por WhatsApp.</p>
        ) : null}
      </div>
    </Modal>
  );
}

type SucursalCantidades = { pedido: number; asignado: number };

type FilaMatriz = {
  productoId: string;
  nombreProducto: string;
  categoria: string;
  existenciaMatriz: number;
  porSucursal: Record<string, SucursalCantidades>;
  pendienteCompra: number;
};

type MatrizData = {
  corte: string;
  cortesDisponibles: string[];
  sucursales: { _id: string; nombre: string }[];
  productos: FilaMatriz[];
};

function fechaISO(desplazamientoDias = 0) {
  // El día se cuenta en la zona de la operación, no en UTC.
  return sumarDias(fechaEnZona(new Date(), ZONA_HORARIA_DEFAULT), desplazamientoDias);
}

function claseBotonFecha(activo: boolean) {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    activo ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
  }`;
}

function SelectorFecha({ valor, onChange }: { valor: string; onChange: (corte: string) => void }) {
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={claseBotonFecha(valor === hoy)} onClick={() => onChange(hoy)}>
        Hoy
      </button>
      <button type="button" className={claseBotonFecha(valor === ayer)} onClick={() => onChange(ayer)}>
        Ayer
      </button>
      <input
        type="date"
        value={valor}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-titos-green-500 focus:ring-2 focus:ring-titos-green-100"
      />
    </div>
  );
}

function MatrizPorProducto({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MatrizData | null>(null);
  const [corteSeleccionado, setCorteSeleccionado] = useState(fechaISO(0));
  const [loading, setLoading] = useState(true);

  async function cargar(corte: string) {
    setLoading(true);
    setCorteSeleccionado(corte);
    const res = await fetch(`/api/pedidos/matriz?corte=${encodeURIComponent(corte)}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar(fechaISO(0));
  }, []);

  return (
    <Modal open onClose={onClose} title="Vista por producto" size="xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-titos-green-900">Corte {corteSeleccionado}</h3>
        <SelectorFecha valor={corteSeleccionado} onChange={cargar} />
      </div>

      {loading ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : !data || data.productos.length === 0 ? (
        <EmptyState message="No hay pedidos nivelados en esta fecha. Ejecuta el Nivelador para generar esta vista." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-black/5">
            <table className="w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-10 border-b border-black/5 bg-titos-green-100/40 px-3 py-2.5 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-titos-green-900"
                  >
                    Producto
                  </th>
                  <th
                    rowSpan={2}
                    className="border-b border-l border-black/5 bg-titos-green-100/70 px-3 py-2.5 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-titos-green-900"
                  >
                    Inv. almacén
                  </th>
                  <th
                    colSpan={data.sucursales.length}
                    className="border-b border-l border-black/5 bg-titos-green-600 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white"
                  >
                    Pedido / surtido
                  </th>
                  <th
                    rowSpan={2}
                    className="border-b border-l border-black/5 bg-titos-green-100/70 px-3 py-2.5 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-titos-green-900"
                  >
                    Pendiente de compra
                  </th>
                </tr>
                <tr>
                  {data.sucursales.map((s) => (
                    <th
                      key={s._id}
                      className="border-b border-l border-black/5 bg-titos-green-100/40 px-3 py-2 text-center text-xs font-medium text-titos-green-700"
                    >
                      {s.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {data.productos.map((p) => (
                  <tr key={p.productoId} className="group">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5 font-medium text-black/80 group-hover:bg-black/1.5">
                      {p.nombreProducto}
                    </td>
                    <td className="border-l border-black/5 px-3 py-2.5 text-center group-hover:bg-black/1.5">
                      <span className="inline-flex min-w-9 items-center justify-center rounded-md bg-titos-green-100 px-2 py-0.5 font-semibold text-titos-green-700">
                        {p.existenciaMatriz}
                      </span>
                    </td>
                    {data.sucursales.map((s) => {
                      const cantidades = p.porSucursal[s._id];
                      const pedido = cantidades?.pedido ?? 0;
                      const asignado = cantidades?.asignado ?? 0;
                      const completo = asignado >= pedido;
                      return (
                        <td
                          key={s._id}
                          className="border-l border-black/5 px-3 py-2.5 text-center group-hover:bg-black/1.5"
                        >
                          {pedido > 0 ? (
                            <span className="inline-flex items-baseline gap-1 tabular-nums">
                              <span className="text-black/35">{pedido}</span>
                              <span className="text-black/15">/</span>
                              <span className={completo ? "font-semibold text-titos-green-700" : "font-semibold text-red-600"}>
                                {asignado}
                              </span>
                            </span>
                          ) : (
                            <span className="text-black/20">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-l border-black/5 px-3 py-2.5 text-center group-hover:bg-black/1.5">
                      {p.pendienteCompra > 0 ? (
                        <span className="inline-flex min-w-9 items-center justify-center rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                          {p.pendienteCompra}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1 text-xs font-medium text-titos-green-600">
                          <Check className="h-3.5 w-3.5" /> cubierto
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-black/40">
            Cada celda de sucursal muestra <span className="font-medium text-black/60">pedido / surtido</span> tras
            ejecutar el Nivelador. En <span className="font-semibold text-red-600">rojo</span>, lo que no alcanzó a
            cubrirse con la existencia disponible.
          </p>
        </>
      )}
    </Modal>
  );
}

export function PedidosManager() {
  const searchParams = useSearchParams();
  const tabInicial = TABS.find((t) => t.value === searchParams.get("tab"))?.value ?? "pendiente";

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>(tabInicial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza enlaces del buscador con la pestaña de la URL
    setTab(tabInicial);
  }, [tabInicial]);
  const [nivelando, setNivelando] = useState(false);
  const [resultadoNivelador, setResultadoNivelador] = useState<string | null>(null);
  const [pedidoModal, setPedidoModal] = useState<Pedido | null>(null);
  const [matrizAbierta, setMatrizAbierta] = useState(false);

  async function cargar() {
    setLoading(true);
    const [pedidosRes, empleadosRes] = await Promise.all([fetch("/api/pedidos"), fetch("/api/empleados")]);
    if (pedidosRes.ok) setPedidos(await pedidosRes.json());
    if (empleadosRes.ok) setEmpleados(await empleadosRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  const visibles = useMemo(() => {
    if (tab === "historial") return pedidos.filter((p) => p.estado === "surtido" || p.estado === "recibido");
    return pedidos.filter((p) => p.estado === tab);
  }, [pedidos, tab]);

  const hayNivelados = useMemo(() => pedidos.some((p) => p.estado !== "pendiente"), [pedidos]);

  async function ejecutarNivelador() {
    setNivelando(true);
    setResultadoNivelador(null);
    const res = await fetch("/api/pedidos/nivelar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setNivelando(false);

    if (!res.ok) {
      setResultadoNivelador(data.error || "No se pudo ejecutar el Nivelador");
      return;
    }

    const necesidades = data.necesidadesCompra?.length ?? 0;
    setResultadoNivelador(
      `Nivelador ejecutado sobre ${data.procesados} pedido(s).${
        necesidades > 0
          ? ` Se generaron ${necesidades} necesidad(es) de compra por faltante — revísalas en Órdenes de compra.`
          : " Toda la demanda quedó cubierta."
      }`
    );
    cargar();
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-titos-green-900">Nivelador</h2>
              <p className="text-sm text-black/50">
                Reparte de forma proporcional y justa la existencia disponible entre todas las sucursales que pidieron
                el mismo producto, cuando la demanda supera lo que hay en almacén.
              </p>
            </div>
            <Button onClick={ejecutarNivelador} disabled={nivelando} className="shrink-0">
              {nivelando ? "Ejecutando..." : "Ejecutar Nivelador"}
            </Button>
          </div>
          {resultadoNivelador ? <p className="mt-3 text-sm text-titos-green-700">{resultadoNivelador}</p> : null}
        </Card>

        <Card className="bg-black/1.5 shadow-none">
          <div className="flex h-full flex-col justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-black/70">Vista por producto</h3>
              <p className="mt-1 text-xs text-black/40">
                Consulta el comparativo de existencia, pedido y surtido por producto de un corte ya nivelado.
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => setMatrizAbierta(true)}
              disabled={!hayNivelados}
              title={hayNivelados ? undefined : "Ejecuta el Nivelador para habilitar esta vista"}
              className="self-start"
            >
              Ver vista por producto
            </Button>
          </div>
        </Card>
      </div>

      <div className="mb-4 flex gap-1 border-b border-black/10">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value ? "border-titos-green-600 text-titos-green-700" : "border-transparent text-black/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : visibles.length === 0 ? (
        <EmptyState message="No hay pedidos en esta vista." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="py-2 pr-2">Sucursal</th>
                  <th className="py-2 pr-2">Folio</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2 pr-2">Corte</th>
                  <th className="py-2 pr-2">Productos</th>
                  <th className="py-2 pr-2">Repartidor</th>
                  <th className="py-2 pr-2">Total</th>
                  <th className="py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p._id} className="border-b border-black/5">
                    <td className="py-2 pr-2 font-medium">{nombreSucursal(p)}</td>
                    <td className="py-2 pr-2 text-black/40">{p.folio}</td>
                    <td className="py-2 pr-2">
                      <EstadoBadge estado={p.estado} />
                    </td>
                    <td className="py-2 pr-2 text-black/40">{p.corte}</td>
                    <td className="py-2 pr-2 text-black/60">{p.items.length}</td>
                    <td className="py-2 pr-2 text-black/60">{repartidorDe(p)?.nombre ?? "—"}</td>
                    <td className="py-2 pr-2 font-medium text-titos-green-900">{formatMoney(totalPedido(p))}</td>
                    <td className="py-2 pr-2">
                      <Button variant="ghost" onClick={() => setPedidoModal(p)}>
                        {p.estado === "nivelado" ? "Ver / Surtir" : "Ver detalle"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pedidoModal ? (
        <PedidoModal
          pedido={pedidoModal}
          empleados={empleados}
          onClose={() => setPedidoModal(null)}
          onRefrescar={cargar}
        />
      ) : null}

      {matrizAbierta ? <MatrizPorProducto onClose={() => setMatrizAbierta(false)} /> : null}
    </div>
  );
}
