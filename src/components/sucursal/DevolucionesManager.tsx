"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, TriangleAlert, Clock, Wallet, Printer } from "lucide-react";
import { Button, Card, EmptyState, FormField, Input, formatMoney } from "@/components/ui";
import { MotivoPosSelector } from "@/components/MotivoPosSelector";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { imprimirTicketDevolucion } from "@/lib/ticketDevolucion";

type ItemDevolvible = {
  productoId: string;
  sku: string;
  nombreProducto: string;
  unidad: string;
  precioUnitario: number;
  cantidadVendida: number;
  cantidadDevuelta: number;
  cantidadDisponible: number;
};

type BusquedaVenta = {
  venta: { _id: string; folio: string; fecha: string; total: number; estado: string; clienteNombre: string };
  items: ItemDevolvible[];
  enVentana: boolean;
  cancelada: boolean;
  horasRestantes: number;
  horasLimite: number;
};

type Devolucion = {
  _id: string;
  folio: string;
  ventaFolio: string;
  fecha: string;
  /** Día de corte al que queda amarrada; va impreso en el ticket del turno. */
  corte?: string;
  total: number;
  montoCredito: number;
  montoEfectivo: number;
  estado: "pendiente" | "pagada" | "cancelada";
  clienteNombre: string;
  motivo: string;
  items: { nombreProducto: string; cantidad: number; unidad: string; precioUnitario: number; subtotal: number }[];
  usuarioId?: { _id: string; nombre: string } | string | null;
  pagadaPorId?: { _id: string; nombre: string } | string | null;
};

/** El id llega poblado con el nombre; si es string, el usuario ya no existe. */
function nombreUsuario(valor: Devolucion["usuarioId"]) {
  return valor && typeof valor !== "string" ? valor.nombre : null;
}

export function DevolucionesManager({ sucursalNombre = "" }: { sucursalNombre?: string }) {
  const zonaHoraria = useZonaHoraria();
  const [folio, setFolio] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<BusquedaVenta | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  const [ultima, setUltima] = useState<Devolucion | null>(null);

  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pagando, setPagando] = useState<string | null>(null);
  const [errorPago, setErrorPago] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/devoluciones");
    setCargando(false);
    if (res.ok) setDevoluciones(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, [cargar]);

  async function buscarVenta(e: React.FormEvent) {
    e.preventDefault();
    if (!folio.trim()) return;
    setErrorBusqueda(null);
    setErrorRegistro(null);
    setUltima(null);
    setResultado(null);
    setCantidades({});
    setBuscando(true);

    const res = await fetch(`/api/devoluciones/buscar-venta?folio=${encodeURIComponent(folio.trim())}`);
    setBuscando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorBusqueda(data.error || "No se pudo buscar la venta");
      return;
    }
    setResultado(await res.json());
  }

  const totalADevolver = useMemo(() => {
    if (!resultado) return 0;
    return resultado.items.reduce(
      (sum, item) => sum + (Number(cantidades[item.productoId]) || 0) * item.precioUnitario,
      0
    );
  }, [resultado, cantidades]);

  const puedeRegistrar =
    !!resultado && resultado.enVentana && !resultado.cancelada && totalADevolver > 0 && !registrando;

  async function registrarDevolucion() {
    if (!resultado) return;
    setErrorRegistro(null);
    setRegistrando(true);

    const items = resultado.items
      .map((item) => ({ productoId: item.productoId, cantidad: Number(cantidades[item.productoId]) || 0 }))
      .filter((item) => item.cantidad > 0);

    const res = await fetch("/api/devoluciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ventaId: resultado.venta._id, items, motivo }),
    });

    setRegistrando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorRegistro(data.error || "No se pudo registrar la devolución");
      return;
    }

    const devolucion: Devolucion = await res.json();
    setUltima(devolucion);
    // Se imprime sola: la copia del turno es el respaldo en papel de la salida
    // de efectivo, y si no sale en el momento nadie vuelve por ella.
    imprimirDevolucion(devolucion);
    setResultado(null);
    setCantidades({});
    setMotivo("");
    setFolio("");
    cargar();
  }

  function imprimirDevolucion(devolucion: Devolucion) {
    imprimirTicketDevolucion(
      {
        folio: devolucion.folio,
        ventaFolio: devolucion.ventaFolio,
        fecha: devolucion.fecha,
        corte: devolucion.corte,
        items: devolucion.items,
        total: devolucion.total,
        montoCredito: devolucion.montoCredito,
        montoEfectivo: devolucion.montoEfectivo,
        estado: devolucion.estado,
        motivo: devolucion.motivo,
        clienteNombre: devolucion.clienteNombre,
      },
      { sucursalNombre, zonaHoraria, cajero: nombreUsuario(devolucion.usuarioId) ?? "" }
    );
  }

  async function pagarDevolucion(id: string) {
    setErrorPago(null);
    setPagando(id);
    const res = await fetch(`/api/devoluciones/${id}/pagar`, { method: "POST" });
    setPagando(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorPago(data.error || "No se pudo pagar la devolución");
      return;
    }
    cargar();
  }

  const pendientes = devoluciones.filter((d) => d.estado === "pendiente");
  const totalPendiente = pendientes.reduce((sum, d) => sum + d.montoEfectivo, 0);

  return (
    <div className="space-y-5">
      {pendientes.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 font-semibold text-amber-900">
                <Wallet className="h-4 w-4" />
                {pendientes.length} {pendientes.length === 1 ? "devolución pendiente" : "devoluciones pendientes"} de
                pago
              </p>
              <p className="text-sm text-amber-800">
                Se generaron cuando el corte del día ya estaba cerrado. Suman {formatMoney(totalPendiente)} por
                reembolsar y saldrán del corte del día en que las pagues.
              </p>
            </div>
          </div>
          {errorPago ? <p className="mt-2 text-sm text-red-600">{errorPago}</p> : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 font-semibold text-titos-green-900">Registrar devolución</h2>
        <p className="mb-4 text-sm text-black/50">
          Busca la venta por su folio: basta el número, sin el <strong>VTA-</strong> ni los ceros. Solo se admiten
          devoluciones dentro de las primeras 48 horas.
        </p>

        <form onSubmit={buscarVenta} className="mb-4 flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Input
              icon={Search}
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="Número de folio, ej. 123 (o VTA-000123)"
            />
          </div>
          <Button type="submit" disabled={buscando || !folio.trim()}>
            {buscando ? "Buscando..." : "Buscar venta"}
          </Button>
        </form>

        {errorBusqueda ? <p className="text-sm text-red-600">{errorBusqueda}</p> : null}

        {ultima ? (
          <div className="rounded-xl bg-titos-green-100 p-4 text-sm text-titos-green-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                Devolución {ultima.folio} registrada por {formatMoney(ultima.total)}
              </p>
              <Button variant="ghost" onClick={() => imprimirDevolucion(ultima)}>
                <span className="inline-flex items-center gap-1.5">
                  <Printer className="h-4 w-4" /> Reimprimir ticket
                </span>
              </Button>
            </div>
            <ul className="mt-1 space-y-0.5 text-titos-green-800">
              {ultima.montoCredito > 0 ? (
                <li>{formatMoney(ultima.montoCredito)} se abonaron a la cuenta por cobrar del cliente.</li>
              ) : null}
              {ultima.montoEfectivo > 0 ? (
                <li>
                  {formatMoney(ultima.montoEfectivo)} en efectivo —{" "}
                  {ultima.estado === "pagada"
                    ? "ya salieron de la caja abierta."
                    : "quedaron PENDIENTES porque el corte del día ya estaba cerrado. Págalos con la caja abierta."}
                </li>
              ) : null}
              <li>El producto ya regresó al inventario.</li>
              <li>
                Se imprimieron dos copias: la del cliente y la del turno. La del turno se guarda en el cajón y
                respalda la salida de efectivo del corte {ultima.corte ? `del ${ultima.corte}` : "del día"}.
              </li>
            </ul>
          </div>
        ) : null}

        {resultado ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/3 p-3 text-sm">
              <div>
                <p className="font-semibold text-titos-green-900">Venta {resultado.venta.folio}</p>
                <p className="text-black/50">
                  {formatFechaHora(resultado.venta.fecha, zonaHoraria)} · {formatMoney(resultado.venta.total)}
                  {resultado.venta.clienteNombre ? ` · ${resultado.venta.clienteNombre}` : ""}
                </p>
              </div>
              {resultado.cancelada ? (
                <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-black/50">
                  Venta cancelada
                </span>
              ) : resultado.enVentana ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-titos-green-100 px-2.5 py-1 text-xs font-semibold text-titos-green-700">
                  <Clock className="h-3.5 w-3.5" />
                  Quedan {resultado.horasRestantes} h para devolver
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Fuera de las {resultado.horasLimite} h
                </span>
              )}
            </div>

            {!resultado.enVentana || resultado.cancelada ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {resultado.cancelada
                  ? "Esta venta está cancelada, su mercancía ya regresó al inventario."
                  : `Ya pasaron más de ${resultado.horasLimite} horas desde esta venta. El sistema no admite la devolución.`}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-black/10 text-black/50">
                        <th className="py-2 pr-2">Producto</th>
                        <th className="py-2 pr-2 text-right">Vendido</th>
                        <th className="py-2 pr-2 text-right">Ya devuelto</th>
                        <th className="py-2 pr-2 text-right">Precio</th>
                        <th className="py-2 pr-2 text-right">Devolver</th>
                        <th className="py-2 pl-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.items.map((item) => {
                        const cantidad = Number(cantidades[item.productoId]) || 0;
                        const agotado = item.cantidadDisponible <= 0;
                        return (
                          <tr key={item.productoId} className={`border-b border-black/5 ${agotado ? "opacity-50" : ""}`}>
                            <td className="py-2 pr-2">
                              {item.nombreProducto}
                              <span className="block font-mono text-xs text-black/40">{item.sku}</span>
                            </td>
                            <td className="py-2 pr-2 text-right text-black/60">
                              {item.cantidadVendida} {item.unidad}
                            </td>
                            <td className="py-2 pr-2 text-right text-black/60">{item.cantidadDevuelta || "—"}</td>
                            <td className="py-2 pr-2 text-right text-black/60">{formatMoney(item.precioUnitario)}</td>
                            <td className="py-2 pr-2 text-right">
                              <div className="ml-auto w-28">
                                <Input
                                  type="number"
                                  min="0"
                                  max={item.cantidadDisponible}
                                  step={item.unidad === "kg" ? "0.001" : "1"}
                                  disabled={agotado}
                                  value={cantidades[item.productoId] ?? ""}
                                  onChange={(e) =>
                                    setCantidades((prev) => ({ ...prev, [item.productoId]: e.target.value }))
                                  }
                                  placeholder={agotado ? "0" : `máx ${item.cantidadDisponible}`}
                                />
                              </div>
                            </td>
                            <td className="py-2 pl-2 text-right font-semibold">
                              {cantidad > 0 ? formatMoney(cantidad * item.precioUnitario) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <FormField label="Motivo de la devolución">
                  <MotivoPosSelector tipo="devolucion" value={motivo} onChange={setMotivo} />
                </FormField>

                {errorRegistro ? <p className="text-sm text-red-600">{errorRegistro}</p> : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-3">
                  <p className="text-lg font-bold text-titos-green-900">A devolver: {formatMoney(totalADevolver)}</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setResultado(null)}>
                      Cancelar
                    </Button>
                    <Button onClick={registrarDevolucion} disabled={!puedeRegistrar}>
                      {registrando ? "Registrando..." : "Registrar devolución"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-titos-green-900">Devoluciones ({devoluciones.length})</h2>
        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : devoluciones.length === 0 ? (
          <EmptyState message="Todavía no se han registrado devoluciones." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="py-2 pr-2">Folio</th>
                  <th className="py-2 pr-2">Venta</th>
                  <th className="py-2 pr-2">Fecha</th>
                  <th className="py-2 pr-2">Productos</th>
                  <th className="py-2 pr-2 text-right">Total</th>
                  <th className="py-2 pr-2 text-right">En efectivo</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="w-px py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {devoluciones.map((d) => (
                  <tr key={d._id} className="border-b border-black/5">
                    <td className="py-2 pr-2 font-mono text-xs">{d.folio}</td>
                    <td className="py-2 pr-2 font-mono text-xs text-black/50">{d.ventaFolio}</td>
                    <td className="py-2 pr-2 text-black/60">
                      {formatFechaHora(d.fecha, zonaHoraria)}
                      {/* Quién la capturó y quién sacó el efectivo: son dos personas
                          distintas cuando el reembolso se paga en otro turno. */}
                      <span className="block text-xs text-black/40">
                        Registró: {nombreUsuario(d.usuarioId) ?? "—"}
                        {d.estado === "pagada" ? ` · Pagó: ${nombreUsuario(d.pagadaPorId) ?? "—"}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-black/60">
                      {d.items.map((i) => `${i.nombreProducto} ×${i.cantidad}`).join(", ")}
                    </td>
                    <td className="py-2 pr-2 text-right font-semibold">{formatMoney(d.total)}</td>
                    <td className="py-2 pr-2 text-right text-black/60">{formatMoney(d.montoEfectivo)}</td>
                    <td className="py-2 pr-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          d.estado === "pagada"
                            ? "bg-titos-green-100 text-titos-green-700"
                            : d.estado === "pendiente"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-black/5 text-black/50"
                        }`}
                      >
                        {d.estado === "pendiente" ? "Pendiente de pago" : d.estado}
                      </span>
                    </td>
                    <td className="w-px py-2 pl-2 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Reimprimir el ticket (cliente y turno)"
                          onClick={() => imprimirDevolucion(d)}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {d.estado === "pendiente" ? (
                          <Button
                            size="sm"
                            className="w-20"
                            onClick={() => pagarDevolucion(d._id)}
                            disabled={pagando === d._id}
                          >
                            {pagando === d._id ? "..." : "Pagar"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
