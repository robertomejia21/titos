"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, KeyRound, ListChecks, Store } from "lucide-react";
import { Button, Card, EmptyState, Select, formatMoney } from "@/components/ui";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { estadoPuente, PUENTE_CAJA_URL, type EstadoPuente } from "@/lib/puenteCaja";
import { operarTerminal, regresarCobro, resolverDudosa, type Avance } from "@/lib/cobroBanorte";
import { ETIQUETA_COMANDO, type ComandoBanorte } from "@/lib/banorte";

// Herramientas de la terminal Banorte integrada: el diagnóstico corre en la PC
// donde está abierta la página (porque es la que tiene el puente de caja), y la
// bitácora muestra cada operación que se le mandó a la terminal.

type TerminalPv = { _id: string; alias: string; cobroIntegrado?: boolean };

const TEXTO_AVANCE: Record<Avance, string> = {
  reservando: "Preparando…",
  esperando_tarjeta: "Esperando a la terminal…",
  recuperando: "Recuperando la respuesta…",
  verificando: "Verificando con Banorte…",
  reversando: "Reversando…",
  registrando: "Registrando…",
};

/**
 * Revisa el puente de caja de esta PC, hace la carga de llave (OBTENER_LLAVE,
 * obligatoria antes del primer cobro) y una prueba de cobro + cancelación.
 */
export function DiagnosticoTerminal() {
  const [terminales, setTerminales] = useState<TerminalPv[]>([]);
  const [terminalId, setTerminalId] = useState("");
  const [puente, setPuente] = useState<EstadoPuente | null>(null);
  const [errorPuente, setErrorPuente] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [bitacora, setBitacora] = useState<string[]>([]);

  const anotar = (linea: string) => setBitacora((b) => [`${new Date().toLocaleTimeString("es-MX")} · ${linea}`, ...b].slice(0, 12));

  useEffect(() => {
    fetch("/api/terminales?puntoVenta=1")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TerminalPv[]) => {
        const integradas = data.filter((t) => t.cobroIntegrado);
        setTerminales(integradas);
        if (integradas.length === 1) setTerminalId(integradas[0]._id);
      })
      .catch(() => setTerminales([]));
  }, []);

  const revisarPuente = useCallback(async () => {
    setErrorPuente(null);
    try {
      const e = await estadoPuente();
      setPuente(e);
      return e;
    } catch (err) {
      setPuente(null);
      setErrorPuente((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- revisión inicial del puente al montar
    revisarPuente();
  }, [revisarPuente]);

  async function cargarLlave() {
    setTrabajando("llave");
    try {
      const r = await operarTerminal({ comando: "OBTENER_LLAVE", terminalId }, { alAvanzar: (a) => anotar(TEXTO_AVANCE[a]) });
      anotar(r.aprobada ? "Llave cargada: la terminal ya puede cobrar." : `Carga de llave no aplicada: ${r.mensaje}`);
    } catch (err) {
      anotar(`Error: ${(err as Error).message}`);
    } finally {
      setTrabajando(null);
    }
  }

  async function pruebaCobro() {
    setTrabajando("prueba");
    try {
      anotar("Cobro de prueba por $1.00: acerca una tarjeta a la terminal.");
      const venta = await operarTerminal({ comando: "VENTA", terminalId, monto: 1 }, { alAvanzar: (a) => anotar(TEXTO_AVANCE[a]) });
      if (!venta.aprobada) {
        anotar(`Cobro de prueba no aprobado: ${venta.mensaje}`);
        return;
      }
      anotar(`Aprobado · aut. ${venta.transaccion.autorizacion ?? ""} · ref. ${venta.transaccion.referencia ?? ""}. Cancelándolo…`);
      const cancelacion = await regresarCobro(
        { terminalId, monto: 1, transaccionOriginalId: venta.transaccion._id },
        { alAvanzar: (a) => anotar(TEXTO_AVANCE[a]) }
      );
      anotar(
        cancelacion.aprobada
          ? `Prueba completa: cobro y ${ETIQUETA_COMANDO[cancelacion.transaccion.comando].toLowerCase()} aprobados.`
          : `OJO: el cobro de prueba no se pudo cancelar (${cancelacion.mensaje}). Cancélalo desde la consola de Banorte.`
      );
    } catch (err) {
      anotar(`Error: ${(err as Error).message}`);
    } finally {
      setTrabajando(null);
    }
  }

  const listo = !!puente && !!terminalId && !puente.ocupado && (puente.pinpad === "simulador" || !!puente.dllCargada);

  return (
    <Card className="mt-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
        <Activity className="h-4 w-4" /> Terminal Banorte desde esta PC
      </h2>
      <p className="mb-3 text-sm text-black/50">
        Usa esto en la PC de caja donde corre el puente ({PUENTE_CAJA_URL}). La carga de llave se hace una vez al instalar
        la terminal (y cuando Banorte lo pida); la prueba cobra $1.00 y lo cancela enseguida.
      </p>

      <div className="mb-3 rounded-lg bg-black/3 p-3 text-sm">
        {errorPuente ? (
          <p className="text-red-700">{errorPuente}</p>
        ) : puente ? (
          <p>
            Puente v{puente.version} · {puente.pinpad === "simulador" ? "SIMULADOR (no llega a Banorte)" : puente.dllCargada ? "librería de Banorte cargada" : "⚠ falta la librería PINPAD.TPV"} ·
            terminal {puente.ip}:{puente.puerto} · modo <strong>{puente.modo}</strong>
            {puente.modo !== "PRD" ? " (prueba: no cobra de verdad)" : ""}
            {puente.credenciales === false ? " · ⚠ faltan usuario/contraseña de Payworks" : ""}
            {puente.ocupado ? " · ocupado" : ""}
          </p>
        ) : (
          <p className="text-black/50">Revisando el puente…</p>
        )}
      </div>

      {terminales.length === 0 ? (
        <p className="mb-3 text-sm text-black/50">
          Este punto de venta no tiene terminales con cobro integrado. Márcalo en la terminal (Terminales de pago).
        </p>
      ) : (
        <div className="mb-3 w-72">
          <Select value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
            <option value="">Elige la terminal</option>
            {terminales.map((t) => (
              <option key={t._id} value={t._id}>
                {t.alias}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={revisarPuente} disabled={!!trabajando}>
          Revisar puente
        </Button>
        <Button variant="ghost" onClick={cargarLlave} disabled={!listo || !!trabajando}>
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-4 w-4" /> {trabajando === "llave" ? "Cargando llave…" : "Cargar llave"}
          </span>
        </Button>
        <Button onClick={pruebaCobro} disabled={!listo || !!trabajando}>
          {trabajando === "prueba" ? "Probando…" : "Prueba de cobro $1.00"}
        </Button>
      </div>

      {bitacora.length > 0 ? (
        <ul className="mt-3 space-y-0.5 rounded-lg bg-black/3 p-3 font-mono text-xs text-black/70">
          {bitacora.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

type Transaccion = {
  _id: string;
  numeroControl: string;
  comando: ComandoBanorte;
  estado: string;
  monto: number;
  createdAt: string;
  sucursalId?: { _id: string; nombre: string } | string | null;
  usuarioId?: { nombre: string } | string | null;
  terminalAlias?: string;
  ultimos4?: string;
  marca?: string;
  autorizacion?: string;
  referencia?: string;
  texto?: string;
  codigo?: string;
  modo?: string;
  simulado?: boolean;
  aplicada?: boolean;
  ventaId?: string | null;
  nota?: string;
};

const COLOR_ESTADO: Record<string, string> = {
  aprobada: "bg-titos-green-100 text-titos-green-900",
  declinada: "bg-red-50 text-red-700",
  rechazada: "bg-red-50 text-red-700",
  error: "bg-red-50 text-red-700",
  sin_respuesta: "bg-amber-50 text-amber-800",
  pendiente: "bg-amber-50 text-amber-800",
  reversada: "bg-black/5 text-black/60",
};

/** Bitácora de operaciones con la terminal, con foco en lo que hay que revisar. */
export function BitacoraBanorte({ sucursales = [] }: { sucursales?: { _id: string; nombre: string }[] }) {
  const zonaHoraria = useZonaHoraria();
  const [filtro, setFiltro] = useState<"todas" | "revisar" | "sinVenta">("revisar");
  const [sucursalId, setSucursalId] = useState("");
  const [lista, setLista] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [verificando, setVerificando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (filtro === "sinVenta") params.set("sinVenta", "1");
    const res = await fetch(`/api/banorte/transacciones?${params}`);
    let datos: Transaccion[] = res.ok ? await res.json() : [];
    if (filtro === "revisar") {
      datos = datos.filter(
        (t) =>
          t.estado === "pendiente" ||
          t.estado === "sin_respuesta" ||
          (t.comando === "VENTA" && t.estado === "aprobada" && !t.aplicada) ||
          !!t.nota
      );
    }
    setLista(datos);
    setCargando(false);
  }, [filtro, sucursalId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar el filtro
    cargar();
  }, [cargar]);

  async function verificar(t: Transaccion) {
    setVerificando(t.numeroControl);
    setMensaje(null);
    try {
      const r = await resolverDudosa(t.numeroControl);
      setMensaje(`${t.numeroControl}: quedó ${r.estado.replace("_", " ")}.`);
      cargar();
    } catch (err) {
      setMensaje(`${t.numeroControl}: ${(err as Error).message}`);
    } finally {
      setVerificando(null);
    }
  }

  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-titos-green-900">
          <ListChecks className="h-4 w-4" /> Operaciones con la terminal Banorte
        </h2>
        <div className="flex flex-wrap gap-2">
          {sucursales.length > 0 ? (
            <div className="w-52">
              <Select icon={Store} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.nombre}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="w-56">
            <Select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
              <option value="revisar">Por revisar</option>
              <option value="sinVenta">Cobros aprobados sin venta</option>
              <option value="todas">Todas (últimas 300)</option>
            </Select>
          </div>
        </div>
      </div>
      <p className="mb-3 text-sm text-black/50">
        «Por revisar» son las que quedaron sin respuesta, los cobros que Banorte aprobó pero que no quedaron en ninguna
        venta, y las que traen una nota. «Verificar» pregunta a Banorte y reversa si hace falta; solo funciona desde la PC
        que tiene el puente de caja de esa terminal.
      </p>
      {mensaje ? <p className="mb-2 text-sm text-titos-green-800">{mensaje}</p> : null}

      {cargando ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : lista.length === 0 ? (
        <EmptyState message="No hay operaciones en este filtro." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-black/50">
                <th className="px-2 py-1.5 text-xs font-medium">Fecha</th>
                <th className="px-2 py-1.5 text-xs font-medium">Sucursal</th>
                <th className="px-2 py-1.5 text-xs font-medium">Operación</th>
                <th className="px-2 py-1.5 text-right text-xs font-medium">Monto</th>
                <th className="px-2 py-1.5 text-xs font-medium">Estado</th>
                <th className="px-2 py-1.5 text-xs font-medium">Tarjeta</th>
                <th className="px-2 py-1.5 text-xs font-medium">Aut. / Ref.</th>
                <th className="px-2 py-1.5 text-xs font-medium">Control</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t._id} className="border-b border-black/5 align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatFechaHora(t.createdAt, zonaHoraria)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                    {t.sucursalId && typeof t.sucursalId !== "string" ? t.sucursalId.nombre : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {ETIQUETA_COMANDO[t.comando] ?? t.comando}
                    {t.simulado || (t.modo && t.modo !== "PRD") ? <span className="ml-1 text-[10px] text-black/40">({t.simulado ? "simulador" : t.modo})</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{t.monto ? formatMoney(t.monto) : "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${COLOR_ESTADO[t.estado] ?? ""}`}>
                      {t.estado.replace("_", " ")}
                    </span>
                    {t.comando === "VENTA" && t.estado === "aprobada" && !t.aplicada ? (
                      <span className="ml-1 text-xs font-semibold text-red-700">sin venta</span>
                    ) : null}
                    {t.nota || (t.estado !== "aprobada" && t.texto) ? (
                      <div className="mt-0.5 max-w-xs text-xs text-black/50">{t.nota || `${t.codigo ?? ""} ${t.texto ?? ""}`}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{t.ultimos4 ? `${t.marca ?? ""} ****${t.ultimos4}` : "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                    {t.autorizacion || "—"}
                    <br />
                    {t.referencia || ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{t.numeroControl}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {["pendiente", "sin_respuesta"].includes(t.estado) && t.comando !== "OBTENER_LLAVE" ? (
                      <Button size="sm" variant="ghost" onClick={() => verificar(t)} disabled={!!verificando}>
                        {verificando === t.numeroControl ? "Verificando…" : "Verificar"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
