"use client";

import { useMemo, useRef, useState } from "react";
import { Banknote, ShieldAlert, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { Button, FormField, Input, Modal, formatMoney } from "@/components/ui";
import { generarIdLocal } from "@/lib/offlinePos";
import { abrirVentanaTicket, cerrarVentanaTicket } from "@/lib/print";
import { imprimirTicketRetiro, type RetiroTicket } from "@/lib/ticketRetiro";
import { importeConLetra } from "@/lib/importeConLetra";
import { formatFechaHora } from "@/lib/zonasHorarias";

export type EstadoEfectivoCaja = {
  abierta: true;
  fondo: number;
  efectivoEnCaja: number;
  excedente: number;
  limite: number;
  activo: boolean;
  requiereRetiro: boolean;
  sugerido: number;
};

// Billetes y monedas que se cuentan en el desglose (mismo orden que el modelo).
const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5] as const;

const MOTIVO_LIMITE = "Retiro parcial por límite de efectivo";

function etiqueta(d: number) {
  if (d < 1) return "50¢";
  return `$${d.toLocaleString("es-MX")}`;
}

/**
 * Ventana que aparece sola cuando el cajón de pesos pasa del límite de efectivo
 * (fondo + límite). El gerente de tienda captura cuánto se lleva, opcionalmente
 * cuenta los billetes, autoriza con su NIP personal y se imprimen las dos copias
 * del comprobante para firmar.
 *
 * Se puede posponer ("el gerente no está"): el punto de venta la vuelve a abrir
 * después del siguiente cobro mientras siga por encima del límite.
 */
export function RetiroLimiteModal({
  estado,
  sucursalNombre,
  zonaHoraria,
  cajero,
  enLinea,
  onPosponer,
  onTerminado,
}: {
  estado: EstadoEfectivoCaja;
  sucursalNombre: string;
  zonaHoraria: string;
  cajero: string;
  enLinea: boolean;
  onPosponer: () => void;
  /** Se cerró la ventana después de registrar el retiro. */
  onTerminado: () => void;
}) {
  const [monto, setMonto] = useState(estado.sugerido > 0 ? String(estado.sugerido) : "");
  const [verDesglose, setVerDesglose] = useState(false);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [observaciones, setObservaciones] = useState("");
  const [nip, setNip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [registrado, setRegistrado] = useState<RetiroTicket | null>(null);
  const [avisoImpresion, setAvisoImpresion] = useState("");
  // Mismo identificador para los reintentos del mismo retiro: si la red se cae
  // después de que el servidor lo guardó, el reintento no saca el dinero dos veces.
  const operacionId = useRef<string | null>(null);

  const sumaDesglose = useMemo(
    () => DENOMINACIONES.reduce((s, d) => s + d * (Number(conteo[String(d)]) || 0), 0),
    [conteo]
  );
  const hayDesglose = verDesglose && sumaDesglose > 0;
  const montoNumero = hayDesglose ? sumaDesglose : Number(monto);
  const quedaria = estado.efectivoEnCaja - (Number.isFinite(montoNumero) ? montoNumero : 0);
  const quedariaExcedente = quedaria - estado.fondo;

  function imprimir(retiro: RetiroTicket, ventana?: Window | null) {
    const ok = imprimirTicketRetiro(retiro, { sucursalNombre, zonaHoraria, cajero }, ventana);
    setAvisoImpresion(
      ok ? "" : "El retiro quedó registrado, pero no se pudo abrir la impresión. Usa Reimprimir y permite las ventanas emergentes."
    );
  }

  async function registrar() {
    if (enviando) return;
    setError(null);
    if (!Number.isFinite(montoNumero) || montoNumero <= 0) {
      setError("Captura el monto que se retira");
      return;
    }
    if (montoNumero - estado.efectivoEnCaja > 0.005) {
      setError(`No se puede retirar más de lo que hay en caja (${formatMoney(estado.efectivoEnCaja)})`);
      return;
    }
    if (nip.length !== 6) {
      setError("El gerente de tienda debe capturar su NIP de 6 dígitos");
      return;
    }
    if (!enLinea) {
      setError("Sin conexión no se pueden registrar retiros: el NIP del gerente se valida en el servidor.");
      return;
    }

    // La ventana del ticket se abre ANTES de esperar al servidor: si se abre
    // después del await, el navegador la trata como emergente y la bloquea.
    const ventana = abrirVentanaTicket();
    setEnviando(true);
    try {
      const motivo = observaciones.trim() ? `${MOTIVO_LIMITE} · ${observaciones.trim()}` : MOTIVO_LIMITE;
      const res = await fetch("/api/caja/retiros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteOperacionId: operacionId.current ?? (operacionId.current = generarIdLocal()),
          origen: "limite",
          moneda: "MXN",
          monto: montoNumero,
          motivo,
          nipSupervisor: nip,
          desglose: hayDesglose
            ? DENOMINACIONES.map((d) => ({ denominacion: d, cantidad: Number(conteo[String(d)]) || 0 })).filter((r) => r.cantidad > 0)
            : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        cerrarVentanaTicket(ventana);
        // Un error de validación (NIP mal, monto de más) es otro intento: el
        // siguiente envío lleva identificador nuevo.
        if (res.status >= 400 && res.status < 500) operacionId.current = null;
        setNip("");
        setError(data.error || "No se pudo registrar el retiro");
        return;
      }
      setNip("");
      setRegistrado(data as RetiroTicket);
      imprimir(data as RetiroTicket, ventana);
    } catch {
      cerrarVentanaTicket(ventana);
      setError("Se perdió la conexión. Revisa la red y vuelve a intentarlo; no se duplicará el retiro.");
    } finally {
      setEnviando(false);
    }
  }

  if (registrado) {
    return (
      <Modal open onClose={onTerminado} title="Retiro de efectivo registrado" icon={Banknote}>
        <p className="mb-3 rounded-xl bg-titos-green-100 px-3 py-2 text-sm font-semibold text-titos-green-800">
          Folio {registrado.folio}. Firmen las dos copias: la de caja se queda en el cajón y la del gerente va con el efectivo.
        </p>
        <div className="space-y-1 rounded-xl bg-black/3 p-4 text-sm">
          <Renglon etiqueta="Importe" valor={formatMoney(registrado.monto)} fuerte />
          <Renglon etiqueta="Con letra" valor={importeConLetra(registrado.monto)} />
          <Renglon etiqueta="Autorizó y recibe" valor={registrado.autorizadoPorNombre || "—"} />
          <Renglon etiqueta="Entrega" valor={cajero || registrado.usuarioNombre || "—"} />
          {registrado.efectivoDespues != null ? (
            <Renglon etiqueta="Queda en caja" valor={formatMoney(registrado.efectivoDespues)} />
          ) : null}
          <Renglon etiqueta="Fecha y hora" valor={formatFechaHora(registrado.fecha, zonaHoraria)} />
        </div>
        {avisoImpresion ? (
          <p role="status" className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {avisoImpresion}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => imprimir(registrado)}>
            <span className="inline-flex items-center gap-2">
              <Printer className="h-4 w-4" /> Reimprimir comprobante
            </span>
          </Button>
          <Button onClick={onTerminado}>Listo</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onPosponer} title="Retiro de efectivo requerido" icon={ShieldAlert}>
      <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">
        La caja tiene {formatMoney(estado.excedente)} además del fondo de {formatMoney(estado.fondo)}, más del límite de{" "}
        {formatMoney(estado.limite)}. Llama al gerente de tienda para hacer un retiro parcial.
      </p>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center text-sm">
        <Cifra etiqueta="Efectivo en caja" valor={formatMoney(estado.efectivoEnCaja)} />
        <Cifra etiqueta="Fondo" valor={formatMoney(estado.fondo)} />
        <Cifra etiqueta="Excedente" valor={formatMoney(estado.excedente)} resaltar />
      </div>

      <FormField label="Monto a retirar (pesos)" className="mb-1">
        <Input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          disabled={hayDesglose}
          value={hayDesglose ? String(sumaDesglose) : monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="0.00"
        />
      </FormField>
      <p className="mb-3 text-xs text-black/50">
        Sugerido: {formatMoney(estado.sugerido)} (lo que hay arriba del fondo, en billetes).{" "}
        {Number.isFinite(montoNumero) && montoNumero > 0 ? (
          <>
            Quedarían {formatMoney(quedaria)} en caja
            {quedariaExcedente - estado.limite > 0.005 ? ", todavía arriba del límite." : "."}
          </>
        ) : null}
      </p>

      <button
        type="button"
        onClick={() => setVerDesglose((v) => !v)}
        className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-titos-green-700 hover:underline"
      >
        {verDesglose ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Contar billetes y monedas (opcional)
      </button>
      {verDesglose ? (
        <div className="mb-3 rounded-xl bg-black/3 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DENOMINACIONES.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <span className="w-12 text-right text-black/60">{etiqueta(d)}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label={`Cantidad de ${etiqueta(d)}`}
                  value={conteo[String(d)] ?? ""}
                  onChange={(e) => setConteo((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, "") }))}
                  className="w-16 rounded-lg border border-black/15 bg-white px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm font-semibold">Total contado: {formatMoney(sumaDesglose)}</p>
        </div>
      ) : null}

      <FormField label="Observaciones (opcional)" className="mb-3">
        <Input
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Ej. va a caja fuerte / depósito bancario"
        />
      </FormField>

      <FormField label="NIP del gerente de tienda (6 dígitos)">
        <Input
          icon={ShieldAlert}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={nip}
          onChange={(e) => setNip(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
          onKeyDown={(e) => {
            if (e.key === "Enter") registrar();
          }}
        />
        <p className="mt-1 text-xs text-black/40">
          El retiro queda firmado con el nombre del gerente y aparece en la bitácora y en el corte.
        </p>
      </FormField>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onPosponer} disabled={enviando}>
          Ahora no, el gerente no está
        </Button>
        <Button onClick={registrar} disabled={enviando}>
          {enviando ? "Registrando..." : "Registrar retiro e imprimir"}
        </Button>
      </div>
    </Modal>
  );
}

function Cifra({ etiqueta, valor, resaltar }: { etiqueta: string; valor: string; resaltar?: boolean }) {
  return (
    <div className={`rounded-xl p-2 ${resaltar ? "bg-amber-50 text-amber-900" : "bg-black/3"}`}>
      <div className="text-xs text-black/50">{etiqueta}</div>
      <div className="font-semibold">{valor}</div>
    </div>
  );
}

function Renglon({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-black/50">{etiqueta}</span>
      <span className={`text-right ${fuerte ? "font-semibold" : "font-medium"}`}>{valor}</span>
    </div>
  );
}
