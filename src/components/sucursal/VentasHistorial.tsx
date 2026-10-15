"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EstadoBadge, Button, FormField, Input, Modal, formatMoney } from "@/components/ui";
import { ChevronDown, ChevronRight, ShieldAlert, Printer } from "lucide-react";
import { imprimirTicketVenta } from "@/lib/ticketVenta";
import { ETIQUETA_TIPO_TARJETA, esTipoTarjeta } from "@/lib/tarjetas";
import { MotivoPosSelector } from "@/components/MotivoPosSelector";
import { formatFecha } from "@/lib/creditoCliente";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { regresarCobro, type Avance } from "@/lib/cobroBanorte";
import type { DatosBanortePago } from "@/lib/banorte";

const ETIQUETAS_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  efectivo_usd: "Efectivo (dólares)",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales de despensa",
  credito: "Crédito del cliente",
};

type VentaItem = { nombreProducto: string; cantidad: number; unidad: string; precioUnitario: number; subtotal: number };
type PagoVenta = {
  metodoPago: string;
  monto: number;
  montoUsd?: number | null;
  tipoCambio?: number | null;
  terminalId?: string | null;
  terminalAlias?: string;
  tarjetaTipo?: string | null;
  banorte?: (Partial<DatosBanortePago> & { transaccionId?: string }) | null;
};
type Venta = {
  _id: string;
  folio: string;
  createdAt: string;
  fecha?: string;
  esVentas2?: boolean;
  items: VentaItem[];
  total: number;
  pagos: PagoVenta[];
  montoRecibido: number | null;
  cambio: number | null;
  estado: "completada" | "cancelada";
  clienteNombre?: string;
  creditoMonto?: number | null;
  creditoFechaVencimiento?: string | null;
};

function resumenPagos(pagos: PagoVenta[] | null | undefined) {
  return (pagos ?? []).map((p) => ETIQUETAS_METODO[p.metodoPago] ?? p.metodoPago).join(" + ");
}

export function VentasHistorial({
  ventas,
  sucursalNombre = "",
}: {
  ventas: Venta[];
  sucursalNombre?: string;
}) {
  const zonaHoraria = useZonaHoraria();
  const router = useRouter();
  const [expandido, setExpandido] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [porCancelar, setPorCancelar] = useState<Venta | null>(null);
  const [motivo, setMotivo] = useState("");
  const [nip, setNip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nipConfigurado, setNipConfigurado] = useState(false);
  // Venta cobrada con la terminal Banorte: primero se regresa el dinero en el
  // banco y luego se cancela aquí.
  const [avanceBanco, setAvanceBanco] = useState<Avance | null>(null);
  const [falloBanco, setFalloBanco] = useState(false);

  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: { nipSupervisorConfigurado?: boolean }) => setNipConfigurado(!!data.nipSupervisorConfigurado))
      .catch(() => setNipConfigurado(false));
  }, []);

  function abrirCancelacion(venta: Venta) {
    setMotivo("");
    setNip("");
    setError(null);
    setFalloBanco(false);
    setPorCancelar(venta);
  }

  async function confirmarCancelacion(sinBanco = false) {
    if (!porCancelar) return;
    setError(null);

    if (!motivo.trim()) {
      setError("Captura el motivo de la cancelación");
      return;
    }
    if (nipConfigurado && !nip) {
      setError("Captura el NIP de supervisor");
      return;
    }

    setCancelando(true);
    const url = `/api/ventas/${porCancelar._id}/cancelar`;
    const enviar = (extra: Record<string, unknown>) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim(), nip, ...extra }),
      });

    const pagoBanorte = (porCancelar.pagos ?? []).find((p) => p.banorte?.transaccionId);
    let extra: Record<string, unknown> = {};
    if (pagoBanorte && sinBanco) {
      extra = { sinBanco: true };
    } else if (pagoBanorte) {
      // 1) Que la cancelación proceda en Titos (NIP, factura, abonos) antes de
      //    tocar el dinero del cliente.
      const validacion = await enviar({ soloValidar: true });
      if (!validacion.ok) {
        const data = await validacion.json().catch(() => ({}));
        setCancelando(false);
        setError(data.error || "No se pudo cancelar la venta");
        return;
      }
      const { cobroBanorte } = await validacion.json();
      if (cobroBanorte) {
        // 2) Regresar el cobro en la terminal.
        try {
          const r = await regresarCobro(
            {
              terminalId: String(pagoBanorte.terminalId ?? ""),
              monto: cobroBanorte.monto,
              transaccionOriginalId: cobroBanorte.transaccionId,
              ventaId: porCancelar._id,
            },
            { alAvanzar: setAvanceBanco }
          );
          if (!r.aprobada) {
            setCancelando(false);
            setAvanceBanco(null);
            setFalloBanco(true);
            setError(`La terminal no regresó el cobro: ${r.mensaje}`);
            return;
          }
          extra = { banorteNumeroControl: r.transaccion.numeroControl };
        } catch (err) {
          setCancelando(false);
          setAvanceBanco(null);
          setFalloBanco(true);
          setError(`No se pudo regresar el cobro en la terminal: ${(err as Error).message}`);
          return;
        }
      }
    }

    // 3) Cancelar la venta en Titos.
    const res = await enviar(extra);
    setCancelando(false);
    setAvanceBanco(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo cancelar la venta");
      return;
    }

    setPorCancelar(null);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-black/5 bg-white shadow-sm">
      <ul className="divide-y divide-black/5">
        {ventas.map((v) => {
          const abierto = expandido === v._id;
          return (
            <li key={v._id}>
              <button
                type="button"
                onClick={() => setExpandido(abierto ? null : v._id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-black/2"
              >
                <span className="flex items-center gap-2 font-medium">
                  {abierto ? <ChevronDown className="h-4 w-4 text-black/30" /> : <ChevronRight className="h-4 w-4 text-black/30" />}
                  {v.folio}
                </span>
                <span className="truncate text-xs text-black/50">{v.clienteNombre || "Público en general"}</span>
                <span className="text-xs text-black/40">
                  {formatFechaHora(v.createdAt, zonaHoraria)}
                </span>
                <span className="text-black/50">{resumenPagos(v.pagos)}</span>
                <span className="font-semibold text-titos-green-900">{formatMoney(v.total)}</span>
                <EstadoBadge estado={v.estado} />
              </button>

              {abierto ? (
                <div className="px-5 pb-4">
                  <ul className="mb-3 divide-y divide-black/5 rounded-lg bg-black/2 px-3 text-sm">
                    {v.items.map((i, idx) => (
                      <li key={idx} className="flex items-center justify-between py-1.5">
                        <span>
                          {i.nombreProducto} × {i.cantidad} {i.unidad}
                        </span>
                        <span className="font-medium">{formatMoney(i.subtotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="mb-3 space-y-1 text-sm text-black/60">
                    {(v.pagos ?? []).map((p, idx) => (
                      <li key={idx} className="flex items-center justify-between">
                        <span>
                          {ETIQUETAS_METODO[p.metodoPago] ?? p.metodoPago}
                          {esTipoTarjeta(p.tarjetaTipo) ? ` — ${ETIQUETA_TIPO_TARJETA[p.tarjetaTipo]}` : ""}
                          {p.montoUsd ? ` — ${p.montoUsd.toFixed(2)} USD` : ""}
                          {p.terminalAlias ? ` — ${p.terminalAlias}` : ""}
                          {p.banorte?.numeroControl
                            ? ` — Banorte ****${p.banorte.ultimos4 ?? ""} · aut. ${p.banorte.autorizacion ?? ""} · ref. ${p.banorte.referencia ?? ""}${p.banorte.simulado || (p.banorte.modo && p.banorte.modo !== "PRD") ? " (prueba)" : ""}`
                            : ""}
                        </span>
                        <span className="font-medium">{formatMoney(p.monto)}</span>
                      </li>
                    ))}
                    {(v.pagos ?? []).some((p) => p.metodoPago === "efectivo") ? (
                      <>
                        <li className="flex items-center justify-between">
                          <span>Efectivo recibido</span>
                          <span className="font-medium">{formatMoney(v.montoRecibido ?? 0)}</span>
                        </li>
                        <li className="flex items-center justify-between">
                          <span>Cambio</span>
                          <span className="font-medium">{formatMoney(v.cambio ?? 0)}</span>
                        </li>
                      </>
                    ) : null}
                  </ul>
                  {v.creditoMonto ? (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {formatMoney(v.creditoMonto)} a crédito de{" "}
                      <strong>{v.clienteNombre || "el cliente"}</strong> — fecha máxima de pago{" "}
                      <strong>{formatFecha(v.creditoFechaVencimiento, zonaHoraria)}</strong>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        imprimirTicketVenta(
                          { ...v, fecha: v.fecha ?? v.createdAt },
                          { sucursalNombre, zonaHoraria }
                        )
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Printer className="h-4 w-4" /> Reimprimir ticket
                      </span>
                    </Button>
                    {v.estado === "completada" ? (
                      <Button variant="danger" onClick={() => abrirCancelacion(v)}>
                        Cancelar venta
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {porCancelar ? (
        <Modal
          open
          onClose={() => setPorCancelar(null)}
          title="Cancelar venta"
          icon={ShieldAlert}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPorCancelar(null)} disabled={cancelando}>
                Regresar
              </Button>
              {falloBanco ? (
                <Button variant="ghost" onClick={() => confirmarCancelacion(true)} disabled={cancelando}>
                  Cancelar solo en Titos
                </Button>
              ) : null}
              <Button variant="danger" onClick={() => confirmarCancelacion()} disabled={cancelando}>
                {cancelando ? "Cancelando..." : "Autorizar y cancelar"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-black/70">
            Se cancela la venta <strong>{porCancelar.folio}</strong> por {formatMoney(porCancelar.total)}. El stock de
            los productos regresa al inventario y la cancelación queda en la bitácora que revisa matriz.
          </p>

          <FormField label="Motivo de la cancelación" className="mb-3">
            <MotivoPosSelector tipo="cancelacion" value={motivo} onChange={setMotivo} autoFocus />
          </FormField>

          {nipConfigurado ? (
            <FormField label="NIP de supervisor">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={nip}
                onChange={(e) => setNip(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarCancelacion();
                }}
                placeholder="••••"
              />
            </FormField>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Matriz todavía no configura el NIP de supervisor, así que la cancelación procede sin autorización pero se
              marca como tal en la bitácora.
            </p>
          )}

          {(porCancelar.pagos ?? []).some((p) => p.banorte?.transaccionId) ? (
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Se cobró con la terminal Banorte (tarjeta ****{(porCancelar.pagos ?? []).find((p) => p.banorte)?.banorte?.ultimos4}). Al autorizar, primero se
              regresa el cobro en la terminal y después se cancela la venta.
            </p>
          ) : null}
          {avanceBanco ? <p className="mt-3 text-sm font-semibold text-sky-900">{avanceBanco === "esperando_tarjeta" ? "Regresando el cobro en la terminal…" : "Comunicando con la terminal…"}</p> : null}
          {falloBanco ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              «Cancelar solo en Titos» cancela la venta sin regresar el dinero: queda anotado para que matriz lo regrese desde la consola de Banorte.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}
