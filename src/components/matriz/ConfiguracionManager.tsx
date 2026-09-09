"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button, Card, FormGrid, FormField, Input, Modal } from "@/components/ui";
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  QrCode,
  Clock,
  CalendarCheck,
  DollarSign,
  Percent,
  KeyRound,
  ShieldCheck,
  BellRing,
  PackageX,
  UserCog,
} from "lucide-react";
import { DIAS_SEMANA, DIA_LABEL } from "@/lib/dias";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { MotivosPosManager } from "@/components/matriz/MotivosPosManager";

type EstadoConexion = "open" | "connecting" | "close" | "desconocido";

const ESTADO_INFO: Record<EstadoConexion, { label: string; className: string }> = {
  open: { label: "Conectado", className: "bg-titos-green-100 text-titos-green-700" },
  connecting: { label: "Conectando...", className: "bg-amber-100 text-amber-700" },
  close: { label: "Desconectado", className: "bg-red-100 text-red-700" },
  desconocido: { label: "Sin datos", className: "bg-black/5 text-black/50" },
};

function QRModal({ onClose, onConectado }: { onClose: () => void; onConectado: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const pedirQR = useCallback(async () => {
    setCargando(true);
    setError(null);
    const res = await fetch("/api/whatsapp/qr");
    setCargando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo obtener el código QR");
      return;
    }

    const data = await res.json();
    setQr(data.qr);
    setPairingCode(data.pairingCode);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del QR al abrir el modal
    pedirQR();
  }, [pedirQR]);

  // Mientras el modal está abierto, revisa cada 3s si ya se vinculó el teléfono.
  useEffect(() => {
    const intervalo = setInterval(async () => {
      const res = await fetch("/api/whatsapp/estado");
      if (!res.ok) return;
      const data = await res.json();
      if (data.estado === "open") {
        clearInterval(intervalo);
        onConectado();
      }
    }, 3000);
    return () => clearInterval(intervalo);
  }, [onConectado]);

  return (
    <Modal open onClose={onClose} title="Vincular WhatsApp" icon={QrCode}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <p className="text-sm text-black/60">
          Abre WhatsApp en el teléfono que usarás para enviar mensajes, ve a{" "}
          <span className="font-medium">Dispositivos vinculados → Vincular un dispositivo</span> y escanea este código.
        </p>

        {cargando ? (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10">
            <Loader2 className="h-8 w-8 animate-spin text-titos-green-600" />
          </div>
        ) : error ? (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : qr ? (
          <Image src={qr} alt="Código QR de WhatsApp" width={256} height={256} className="rounded-xl border border-black/10" unoptimized />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-black/10 p-4 text-sm text-black/40">
            No se recibió un código QR. La instancia podría ya estar conectada.
          </div>
        )}

        {pairingCode ? (
          <p className="text-sm text-black/60">
            O usa el código de vinculación: <span className="font-mono font-semibold">{pairingCode}</span>
          </p>
        ) : null}

        <Button type="button" variant="ghost" onClick={pedirQR} disabled={cargando}>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" /> Generar nuevo código
          </span>
        </Button>
      </div>
    </Modal>
  );
}

export function ConfiguracionManager() {
  const zonaHoraria = useZonaHoraria();
  const [estado, setEstado] = useState<EstadoConexion>("desconocido");
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [mostrarQR, setMostrarQR] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmandoDesconectar, setConfirmandoDesconectar] = useState(false);

  const [diasLaborales, setDiasLaborales] = useState<string[]>([]);
  const [horaCorte, setHoraCorte] = useState("16:00");
  const [tipoCambio, setTipoCambio] = useState("17");
  // Sello de la última vez que se movió: un tipo de cambio viejo regala
  // mercancía y no se nota hasta el corte.
  const [tipoCambioActualizadoEn, setTipoCambioActualizadoEn] = useState<string | null>(null);
  const [tipoCambioActualizadoPor, setTipoCambioActualizadoPor] = useState("");
  const [tasaIvaFactura, setTasaIvaFactura] = useState("0");
  const [alertasActivas, setAlertasActivas] = useState(true);
  const [horasLimiteSurtido, setHorasLimiteSurtido] = useState("24");
  const [horasLimiteRecepcion, setHorasLimiteRecepcion] = useState("24");
  /** Se captura como texto separado por comas; se manda como arreglo. */
  const [destinatariosAlertas, setDestinatariosAlertas] = useState("");
  const [alertaInventarioCero, setAlertaInventarioCero] = useState(true);
  const [destinatariosCompras, setDestinatariosCompras] = useState("");
  const [guardandoAlertas, setGuardandoAlertas] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [mensajeAlertas, setMensajeAlertas] = useState<string | null>(null);

  const [aceptaDolares, setAceptaDolares] = useState(true);
  // 0 = se aceptan todas las denominaciones (la política de hoy).
  const [denominacionMaximaUsd, setDenominacionMaximaUsd] = useState("0");
  // Topes de cuánto de una venta se puede liquidar en billete verde.
  // 0 en cualquiera de los dos = ese tope no aplica.
  const [porcentajeMaximoUsd, setPorcentajeMaximoUsd] = useState("0");
  const [montoMaximoUsd, setMontoMaximoUsd] = useState("0");
  const [cargandoConfig, setCargandoConfig] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nipConfigurado, setNipConfigurado] = useState(false);
  const [nip, setNip] = useState("");
  const [nipConfirmacion, setNipConfirmacion] = useState("");
  const [guardandoNip, setGuardandoNip] = useState(false);
  const [mensajeNip, setMensajeNip] = useState<string | null>(null);
  const [errorNip, setErrorNip] = useState<string | null>(null);

  // NIP de 6 dígitos que se exige para dar de alta (o ascender a) un supervisor.
  const [nipSupConfigurado, setNipSupConfigurado] = useState(false);
  const [nipSup, setNipSup] = useState("");
  const [nipSupConfirmacion, setNipSupConfirmacion] = useState("");
  const [guardandoNipSup, setGuardandoNipSup] = useState(false);
  const [mensajeNipSup, setMensajeNipSup] = useState<string | null>(null);
  const [errorNipSup, setErrorNipSup] = useState<string | null>(null);

  const cargado = useRef(false);

  const cargarEstado = useCallback(async () => {
    setCargandoEstado(true);
    const res = await fetch("/api/whatsapp/estado");
    setCargandoEstado(false);
    if (!res.ok) {
      setEstado("desconocido");
      return;
    }
    const data = await res.json();
    setEstado(data.estado ?? "desconocido");
  }, []);

  const cargarConfiguracion = useCallback(async () => {
    setCargandoConfig(true);
    const res = await fetch("/api/configuracion");
    setCargandoConfig(false);
    if (!res.ok) return;
    const data = await res.json();
    setDiasLaborales(data.diasLaborales ?? []);
    setHoraCorte(data.horaCorte ?? "16:00");
    setTipoCambio(String(data.tipoCambio ?? 17));
    setTipoCambioActualizadoEn(data.tipoCambioActualizadoEn ?? null);
    setTipoCambioActualizadoPor(data.tipoCambioActualizadoPor ?? "");
    setTasaIvaFactura(String(data.tasaIvaFactura ?? 0));
    setAlertasActivas(data.alertas?.activas !== false);
    setHorasLimiteSurtido(String(data.alertas?.horasLimiteSurtido ?? 24));
    setHorasLimiteRecepcion(String(data.alertas?.horasLimiteRecepcion ?? 24));
    setDestinatariosAlertas((data.alertas?.destinatarios ?? []).join(", "));
    setAlertaInventarioCero(data.alertas?.inventarioCeroActiva !== false);
    setDestinatariosCompras((data.alertas?.destinatariosCompras ?? []).join(", "));
    setAceptaDolares(data.dolares?.aceptaPagos !== false);
    setDenominacionMaximaUsd(String(data.dolares?.denominacionMaxima ?? 0));
    setPorcentajeMaximoUsd(String(data.dolares?.porcentajeMaximo ?? 0));
    setMontoMaximoUsd(String(data.dolares?.montoMaximoUsd ?? 0));
    setNipConfigurado(!!data.nipSupervisorConfigurado);
    setNipSupConfigurado(!!data.nipCreacionSupervisorConfigurado);
  }, []);

  useEffect(() => {
    if (cargado.current) return;
    cargado.current = true;
    cargarEstado();
    cargarConfiguracion();
  }, [cargarEstado, cargarConfiguracion]);

  function alternarDia(dia: string) {
    setDiasLaborales((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  }

  async function guardarAjustes() {
    setGuardando(true);
    setMensaje(null);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        diasLaborales,
        horaCorte,
        tipoCambio: Number(tipoCambio),
        tasaIvaFactura: Number(tasaIvaFactura),
        dolares: {
          aceptaPagos: aceptaDolares,
          denominacionMaxima: Number(denominacionMaximaUsd) || 0,
          porcentajeMaximo: Number(porcentajeMaximoUsd) || 0,
          montoMaximoUsd: Number(montoMaximoUsd) || 0,
        },
      }),
    });
    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMensaje(data.error || "No se pudieron guardar los ajustes");
      return;
    }

    // La respuesta trae el sello recién puesto al tipo de cambio.
    const data = await res.json().catch(() => null);
    if (data) {
      setTipoCambioActualizadoEn(data.tipoCambioActualizadoEn ?? null);
      setTipoCambioActualizadoPor(data.tipoCambioActualizadoPor ?? "");
    }
    setMensaje("Ajustes guardados.");
  }

  async function guardarAlertas() {
    setGuardandoAlertas(true);
    setMensajeAlertas(null);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertas: {
          activas: alertasActivas,
          horasLimiteSurtido: Number(horasLimiteSurtido),
          horasLimiteRecepcion: Number(horasLimiteRecepcion),
          destinatarios: destinatariosAlertas
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
          inventarioCeroActiva: alertaInventarioCero,
          destinatariosCompras: destinatariosCompras
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
        },
      }),
    });
    setGuardandoAlertas(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMensajeAlertas(data.error || "No se pudieron guardar las alertas");
      return;
    }
    setMensajeAlertas("Alertas guardadas.");
  }

  /** Dispara el mismo barrido que corre en automático, para poder probarlo. */
  async function revisarAhora() {
    setRevisando(true);
    setMensajeAlertas(null);
    const res = await fetch("/api/cron/alertas");
    setRevisando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMensajeAlertas(data.error || "No se pudo ejecutar la revisión");
      return;
    }

    const r = await res.json();
    if (!r.ejecutado) {
      setMensajeAlertas(r.motivo ?? "La revisión no se ejecutó");
      return;
    }
    setMensajeAlertas(
      `Revisión lista: ${r.surtidoAtrasado} pedido(s) sin surtir y ${r.recepcionAtrasada} sin confirmar recepción. ` +
        `${r.mensajesEnviados} mensaje(s) enviados, ${r.mensajesFallidos} fallidos.`
    );
  }

  async function guardarNip() {
    setErrorNip(null);
    setMensajeNip(null);

    if (!/^\d{4,8}$/.test(nip)) {
      setErrorNip("El NIP debe tener de 4 a 8 dígitos");
      return;
    }
    if (nip !== nipConfirmacion) {
      setErrorNip("Los dos NIP no coinciden");
      return;
    }

    setGuardandoNip(true);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nipSupervisor: nip }),
    });
    setGuardandoNip(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorNip(data.error || "No se pudo guardar el NIP");
      return;
    }

    setNip("");
    setNipConfirmacion("");
    setNipConfigurado(true);
    setMensajeNip("NIP de supervisor actualizado.");
  }

  async function quitarNip() {
    setErrorNip(null);
    setMensajeNip(null);
    setGuardandoNip(true);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nipSupervisor: null }),
    });
    setGuardandoNip(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorNip(data.error || "No se pudo quitar el NIP");
      return;
    }

    setNipConfigurado(false);
    setMensajeNip("Se quitó el NIP. Las cancelaciones se seguirán registrando, pero ya no piden autorización.");
  }

  async function guardarNipSupervisores() {
    setErrorNipSup(null);
    setMensajeNipSup(null);

    if (!/^\d{6}$/.test(nipSup)) {
      setErrorNipSup("El NIP debe ser de exactamente 6 dígitos");
      return;
    }
    if (nipSup !== nipSupConfirmacion) {
      setErrorNipSup("Los dos NIP no coinciden");
      return;
    }

    setGuardandoNipSup(true);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nipCreacionSupervisor: nipSup }),
    });
    setGuardandoNipSup(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorNipSup(data.error || "No se pudo guardar el NIP");
      return;
    }

    setNipSup("");
    setNipSupConfirmacion("");
    setNipSupConfigurado(true);
    setMensajeNipSup("NIP para crear supervisores actualizado.");
  }

  async function quitarNipSupervisores() {
    setErrorNipSup(null);
    setMensajeNipSup(null);
    setGuardandoNipSup(true);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nipCreacionSupervisor: null }),
    });
    setGuardandoNipSup(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorNipSup(data.error || "No se pudo quitar el NIP");
      return;
    }

    setNipSupConfigurado(false);
    setMensajeNipSup("Se quitó el NIP. Mientras no haya uno, no se pueden dar de alta usuarios supervisores.");
  }

  async function desconectar() {
    setDesconectando(true);
    const res = await fetch("/api/whatsapp/desconectar", { method: "POST" });
    setDesconectando(false);
    setConfirmandoDesconectar(false);
    if (res.ok) cargarEstado();
  }

  const info = ESTADO_INFO[estado];

  useEffect(() => {
    if (cargandoConfig) return;
    const go = () => { const id = decodeURIComponent(window.location.hash.slice(1)); if (id) document.getElementById(id)?.scrollIntoView({block: "center"}); };
    const frame = requestAnimationFrame(go);
    window.addEventListener("hashchange", go);
    return () => {cancelAnimationFrame(frame); window.removeEventListener("hashchange", go);};
  }, [cargandoConfig]);

  /** Cómo queda la política de dólares con lo que hay capturado ahora mismo. */
  const resumenTopesDolares = (() => {
    if (!aceptaDolares) return "Los pagos en dólares están desactivados, así que estos topes no se aplican.";
    const porcentaje = Number(porcentajeMaximoUsd) || 0;
    const monto = Number(montoMaximoUsd) || 0;
    if (porcentaje <= 0 && monto <= 0) return "Sin topes: una venta completa se puede pagar en dólares.";
    const partes = [
      porcentaje > 0 ? `hasta el ${porcentaje}% de cada venta` : "cualquier porcentaje de la venta",
      monto > 0 ? `un máximo de ${monto.toFixed(2)} USD por venta` : "",
    ].filter(Boolean);
    return `Hoy se acepta ${partes.join(", con ")}.`;
  })();

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="whatsapp" className="font-semibold text-titos-green-900">Conexión de WhatsApp</h2>
            <p className="text-sm text-black/50">
              Se usa para enviar pedidos y órdenes de compra en PDF por WhatsApp (Evolution API).
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${info.className}`}>
            {estado === "open" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {cargandoEstado ? "Consultando..." : info.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={cargarEstado} disabled={cargandoEstado}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4" /> Actualizar estado
            </span>
          </Button>

          {estado !== "open" ? (
            <Button type="button" onClick={() => setMostrarQR(true)}>
              <span className="flex items-center gap-1.5">
                <QrCode className="h-4 w-4" /> Vincular con código QR
              </span>
            </Button>
          ) : confirmandoDesconectar ? (
            <>
              <span className="text-sm text-black/60">¿Desconectar WhatsApp?</span>
              <Button type="button" variant="ghost" onClick={() => setConfirmandoDesconectar(false)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={desconectar} disabled={desconectando}>
                {desconectando ? "Desconectando..." : "Sí, desconectar"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="danger" onClick={() => setConfirmandoDesconectar(true)}>
              Desconectar
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h2 id="horarios" className="mb-1 font-semibold text-titos-green-900">Días y horario laborales</h2>
        <p className="mb-4 text-sm text-black/50">
          Define los días de operación y la hora de corte de pedidos del día.
        </p>

        {cargandoConfig ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : (
          <FormGrid>
            <FormField label="Días laborales">
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-black/10 p-3">
                {DIAS_SEMANA.map((dia) => (
                  <label key={dia} className="flex items-center gap-1.5 text-sm text-black/70">
                    <input type="checkbox" checked={diasLaborales.includes(dia)} onChange={() => alternarDia(dia)} />
                    {DIA_LABEL[dia]}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="Hora de corte de pedidos">
              <Input icon={Clock} type="time" value={horaCorte} onChange={(e) => setHoraCorte(e.target.value)} />
            </FormField>
            <FormField label="Tipo de cambio (pesos por dólar)">
              <Input id="tipo-cambio"
                icon={DollarSign}
                type="number"
                min="0.01"
                step="0.01"
                value={tipoCambio}
                onChange={(e) => setTipoCambio(e.target.value)}
                placeholder="17.00"
              />
              {/* Sin esta línea nadie se entera de que el tipo de cambio lleva
                  tres semanas sin moverse hasta que el corte no cuadra. */}
              <p className="mt-1 text-xs text-black/40">
                {tipoCambioActualizadoEn
                  ? `Última actualización: ${formatFechaHora(tipoCambioActualizadoEn, zonaHoraria)}${
                      tipoCambioActualizadoPor ? ` por ${tipoCambioActualizadoPor}` : ""
                    }.`
                  : "Todavía no se ha ajustado a mano: se está usando el valor con el que arrancó el sistema."}{" "}
                Se aplica a los cobros en dólares desde el momento en que se guarda; cada venta se queda con el tipo de
                cambio que tenía al cobrarse.
              </p>
            </FormField>
            <FormField label="Pagos en dólares">
              <div className="space-y-2 rounded-lg border border-black/10 p-3">
                <label className="flex items-center gap-2 text-sm text-black/70">
                  <input
                    type="checkbox"
                    checked={aceptaDolares}
                    onChange={(e) => setAceptaDolares(e.target.checked)}
                  />
                  Recibir dólares en billete en el punto de venta
                </label>
                <div>
                  <label className="mb-1 block text-xs text-black/50">
                    Denominación máxima aceptada (0 = se aceptan todos los billetes)
                  </label>
                  <Input
                    icon={DollarSign}
                    type="number"
                    min="0"
                    step="1"
                    disabled={!aceptaDolares}
                    value={denominacionMaximaUsd}
                    onChange={(e) => setDenominacionMaximaUsd(e.target.value)}
                    placeholder="0"
                  />
                  <p className="mt-1 text-xs text-black/40">
                    Hoy se aceptan todos. Si más adelante se decide no recibir billetes de cierta denominación, se
                    pone el tope aquí y el punto de venta se lo avisa al cajero. El cambio siempre se entrega en pesos.
                  </p>
                </div>
              </div>
            </FormField>
            <FormField label="Tasa de IVA para facturas (%)">
              <Input id="iva-facturas"
                icon={Percent}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={tasaIvaFactura}
                onChange={(e) => setTasaIvaFactura(e.target.value)}
                placeholder="0"
              />
            </FormField>
          </FormGrid>
        )}

        {/* Cuánto de una venta se puede liquidar en billete verde. Va aquí,
            pegado al tipo de cambio, porque los dos se revisan juntos: quien
            ajusta el tipo de cambio es quien decide cuántos dólares aguanta la
            caja ese día. */}
        {!cargandoConfig ? (
          <div className="mt-5 border-t border-black/10 pt-4">
            <h3 id="limites-dolares" className="mb-1 font-semibold text-titos-green-900">Límite de aceptación de dólares</h3>
            <p className="mb-3 text-sm text-black/50">
              Hasta cuánto de una venta se acepta en dólares. Son dos topes independientes y se aplican los dos: gana
              el que se alcance primero. El punto de venta avisa al cajero antes de cobrar y el servidor lo vuelve a
              validar, así que no se puede saltar desde el navegador.
            </p>

            <FormGrid>
              <FormField label="Porcentaje máximo del total de la venta (%)">
                <Input
                  icon={Percent}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  disabled={!aceptaDolares}
                  value={porcentajeMaximoUsd}
                  onChange={(e) => setPorcentajeMaximoUsd(e.target.value)}
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-black/40">
                  0 = sin tope, la venta completa se puede pagar en dólares. Con 50, una venta de $1,000 admite como
                  máximo $500 en dólares y el resto va en otra forma de pago.
                </p>
              </FormField>
              <FormField label="Monto máximo en dólares por venta (USD)">
                <Input
                  icon={DollarSign}
                  type="number"
                  min="0"
                  step="1"
                  disabled={!aceptaDolares}
                  value={montoMaximoUsd}
                  onChange={(e) => setMontoMaximoUsd(e.target.value)}
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-black/40">
                  0 = sin tope. Es el candado del cajón: limita cuántos billetes verdes se acumulan en un solo cobro,
                  sin importar de cuánto sea la venta.
                </p>
              </FormField>
            </FormGrid>

            <p className="mt-3 rounded-lg bg-black/3 px-3 py-2 text-xs text-black/50">{resumenTopesDolares}</p>
          </div>
        ) : null}

        {mensaje ? <p className="mt-3 text-sm text-titos-green-700">{mensaje}</p> : null}

        <div className="mt-4">
          <Button onClick={guardarAjustes} disabled={guardando || cargandoConfig}>
            <span className="flex items-center gap-1.5">
              <CalendarCheck className="h-4 w-4" /> {guardando ? "Guardando..." : "Guardar ajustes"}
            </span>
          </Button>
        </div>
      </Card>

      <Card>
        <h2 id="alertas-pedidos" className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
          <BellRing className="h-4.5 w-4.5 text-titos-green-700" />
          Alertas de pedidos atrasados
        </h2>
        <p className="mb-4 text-sm text-black/50">
          El sistema revisa periódicamente los pedidos que se quedaron atorados y manda un WhatsApp. Los de{" "}
          <strong>surtido atrasado</strong> van a los números de aquí abajo; los de <strong>recepción atrasada</strong>{" "}
          van al WhatsApp de la sucursal que no ha confirmado su mercancía. De cada pedido se avisa una sola vez, para
          no repetir el mismo mensaje en cada revisión.
        </p>

        <label className="mb-3 flex items-center gap-2 text-sm text-black/70">
          <input
            type="checkbox"
            checked={alertasActivas}
            onChange={(e) => setAlertasActivas(e.target.checked)}
          />
          Mandar alertas automáticas
        </label>

        <FormGrid className="mb-3">
          <FormField label="Horas para que matriz surta un pedido">
            <Input
              icon={Clock}
              type="number"
              min="1"
              step="1"
              disabled={!alertasActivas}
              value={horasLimiteSurtido}
              onChange={(e) => setHorasLimiteSurtido(e.target.value)}
            />
          </FormField>
          <FormField label="Horas para que la sucursal confirme la recepción">
            <Input
              icon={Clock}
              type="number"
              min="1"
              step="1"
              disabled={!alertasActivas}
              value={horasLimiteRecepcion}
              onChange={(e) => setHorasLimiteRecepcion(e.target.value)}
            />
          </FormField>
        </FormGrid>

        <FormField label="WhatsApp que reciben los avisos de surtido atrasado" className="mb-3">
          <Input
            icon={BellRing}
            disabled={!alertasActivas}
            value={destinatariosAlertas}
            onChange={(e) => setDestinatariosAlertas(e.target.value)}
            placeholder="6641234567, 6647654321"
          />
          <p className="mt-1 text-xs text-black/40">
            Separados por coma. Si se deja vacío, el aviso de surtido no se manda a nadie.
          </p>
        </FormField>

        {/* Aviso al área de compras: distinto destinatario y distinto disparador
            que los pedidos atrasados, por eso va en su propio bloque. */}
        <div className="mb-3 border-t border-black/10 pt-4">
          <h3 id="alertas-inventario" className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
            <PackageX className="h-4 w-4 text-red-600" />
            Aviso a compras por producto agotado
          </h3>
          <p className="mb-3 text-sm text-black/50">
            Cuando una venta se lleva la última existencia de un producto, el sistema le manda un WhatsApp al área de
            compras y mete el producto en las necesidades por ordenar. El faltante también aparece en el tablero de
            matriz, así que aunque el mensaje no salga no se pierde.
          </p>

          <label className="mb-3 flex items-center gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              checked={alertaInventarioCero}
              onChange={(e) => setAlertaInventarioCero(e.target.checked)}
            />
            Avisar cuando un producto quede en cero
          </label>

          <FormField label="WhatsApp del área de compras">
            <Input
              icon={PackageX}
              disabled={!alertaInventarioCero}
              value={destinatariosCompras}
              onChange={(e) => setDestinatariosCompras(e.target.value)}
              placeholder="6641234567, 6647654321"
            />
            <p className="mt-1 text-xs text-black/40">
              Separados por coma. Mientras el producto siga agotado no se repite el aviso: se manda una sola vez por
              producto y tienda, y se vuelve a habilitar cuando entra mercancía.
            </p>
          </FormField>
        </div>

        {mensajeAlertas ? <p className="mb-3 text-sm text-titos-green-700">{mensajeAlertas}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={guardarAlertas} disabled={guardandoAlertas || cargandoConfig}>
            {guardandoAlertas ? "Guardando..." : "Guardar alertas"}
          </Button>
          <Button variant="ghost" onClick={revisarAhora} disabled={revisando}>
            {revisando ? "Revisando..." : "Revisar pedidos atrasados ahora"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 id="nip-operaciones" className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
          <ShieldCheck className="h-4.5 w-4.5 text-titos-green-700" />
          NIP de supervisor
        </h2>
        <p className="mb-4 text-sm text-black/50">
          Autoriza las cancelaciones en los puntos de venta de matriz y de las sucursales: quitar un producto del
          carrito, cancelar una venta en curso o cancelar una venta ya cobrada. Todas quedan en la bitácora de
          cancelaciones, con o sin NIP.
        </p>

        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            nipConfigurado ? "bg-titos-green-100 text-titos-green-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {nipConfigurado
            ? "Hay un NIP configurado: los cajeros deben capturarlo para poder cancelar."
            : "Todavía no hay NIP. Las cancelaciones se registran, pero cualquier cajero puede hacerlas sin autorización."}
        </div>

        <FormGrid>
          <FormField label={nipConfigurado ? "Nuevo NIP (4 a 8 dígitos)" : "NIP (4 a 8 dígitos)"}>
            <Input
              icon={KeyRound}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={nip}
              onChange={(e) => setNip(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </FormField>
          <FormField label="Confirmar NIP">
            <Input
              icon={KeyRound}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={nipConfirmacion}
              onChange={(e) => setNipConfirmacion(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </FormField>
        </FormGrid>

        {errorNip ? <p className="mt-3 text-sm text-red-600">{errorNip}</p> : null}
        {mensajeNip ? <p className="mt-3 text-sm text-titos-green-700">{mensajeNip}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={guardarNip} disabled={guardandoNip || cargandoConfig}>
            {guardandoNip ? "Guardando..." : nipConfigurado ? "Cambiar NIP" : "Guardar NIP"}
          </Button>
          {nipConfigurado ? (
            <Button variant="ghost" onClick={quitarNip} disabled={guardandoNip}>
              Quitar NIP
            </Button>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 id="nip-supervisores" className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
          <UserCog className="h-4.5 w-4.5 text-titos-green-700" />
          NIP para crear supervisores
        </h2>
        <p className="mb-4 text-sm text-black/50">
          Un supervisor es quien autoriza cancelaciones y retiros en el mostrador, así que darle ese rol a alguien no
          debe depender nada más de tener abierta la pantalla de usuarios. Con este NIP de 6 dígitos se autoriza crear
          un usuario con rol de supervisor, ascender a uno existente y marcar un rol nuevo como de supervisor. Es
          distinto del NIP de cancelaciones a propósito: ese lo conocen los supervisores, y con él no debe poder
          nombrarse a otro.
        </p>

        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            nipSupConfigurado ? "bg-titos-green-100 text-titos-green-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {nipSupConfigurado
            ? "Hay un NIP configurado: se pide cada vez que se da de alta o se asciende a un supervisor."
            : "Todavía no hay NIP. Mientras no lo haya, el sistema no deja crear usuarios con rol de supervisor."}
        </div>

        <FormGrid>
          <FormField label={nipSupConfigurado ? "Nuevo NIP (6 dígitos)" : "NIP (6 dígitos)"}>
            <Input
              icon={KeyRound}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={nipSup}
              onChange={(e) => setNipSup(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
            />
          </FormField>
          <FormField label="Confirmar NIP">
            <Input
              icon={KeyRound}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={nipSupConfirmacion}
              onChange={(e) => setNipSupConfirmacion(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
            />
          </FormField>
        </FormGrid>

        {errorNipSup ? <p className="mt-3 text-sm text-red-600">{errorNipSup}</p> : null}
        {mensajeNipSup ? <p className="mt-3 text-sm text-titos-green-700">{mensajeNipSup}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={guardarNipSupervisores} disabled={guardandoNipSup || cargandoConfig}>
            {guardandoNipSup ? "Guardando..." : nipSupConfigurado ? "Cambiar NIP" : "Guardar NIP"}
          </Button>
          {nipSupConfigurado ? (
            <Button variant="ghost" onClick={quitarNipSupervisores} disabled={guardandoNipSup}>
              Quitar NIP
            </Button>
          ) : null}
        </div>
      </Card>

      <MotivosPosManager />

      {mostrarQR ? (
        <QRModal
          onClose={() => {
            setMostrarQR(false);
            cargarEstado();
          }}
          onConectado={() => {
            setMostrarQR(false);
            cargarEstado();
          }}
        />
      ) : null}
    </div>
  );
}
