"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Snowflake,
  Truck,
  Tv,
  User,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, FormField, FormGrid, Input, Modal, Select } from "@/components/ui";
import { DIAS_SEMANA, DIA_LABEL } from "@/lib/dias";
import { fechaEnZona, sumarDias } from "@/lib/zonasHorarias";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type TipoRuta = "primera_vuelta" | "segunda_vuelta" | "especial";
type TipoParada = "sucursal" | "recoleccion" | "basura" | "otro";
type Parada = { tipo: TipoParada; sucursalId: string | null; descripcion: string; nombre?: string };
type PedidoRol = { _id: string; folio: string; sucursalNombre: string; vuelta: number; estado: string };

type Salida = {
  _id?: string;
  rutaId: string | null;
  nombre: string;
  tipo: TipoRuta;
  horaSalida: string;
  duracionMin: number;
  requiereRefrigerado: boolean;
  vehiculoId: string | null;
  choferId: string | null;
  estado: "programada" | "en_ruta" | "completada";
  motivoSugerencia: string;
  ajustadaManualmente: boolean;
  notas: string;
  paradas: Parada[];
  pedidos: PedidoRol[];
};

type Rol = {
  fecha: string;
  existe: boolean;
  actualizadoEn: string | null;
  actualizadoPorNombre: string;
  salidas: Salida[];
  pedidosSinSalida: PedidoRol[];
  conflictos: string[];
};

type Vehiculo = { _id: string; nombre: string; tipo: "estaquita" | "camion"; refrigerado: boolean; placas: string; notas: string; activo: boolean };
type Chofer = { _id: string; nombre: string; puesto: string; activo: boolean };
type SucursalOpcion = { _id: string; nombre: string };
type Ruta = {
  _id: string;
  nombre: string;
  tipo: TipoRuta;
  horaSalida: string;
  duracionMin: number;
  diasSemana: string[];
  paradas: Parada[];
  requiereRefrigerado: boolean;
  vehiculoPreferidoId: string | null;
  choferResponsableId: string | null;
  choferSustitutoId: string | null;
  notas: string;
  activo: boolean;
};
type Catalogo = { vehiculos: Vehiculo[]; rutas: Ruta[]; choferes: Chofer[]; sucursales: SucursalOpcion[] };

const TIPO_RUTA_LABEL: Record<TipoRuta, string> = {
  primera_vuelta: "Primera vuelta",
  segunda_vuelta: "Segunda vuelta",
  especial: "Especial",
};
const TIPO_RUTA_ESTILO: Record<TipoRuta, string> = {
  primera_vuelta: "bg-sky-100 text-sky-800",
  segunda_vuelta: "bg-titos-orange-100 text-titos-orange-700",
  especial: "bg-violet-100 text-violet-800",
};
const TIPO_PARADA_LABEL: Record<TipoParada, string> = {
  sucursal: "Entrega en tienda",
  recoleccion: "Recolección",
  basura: "Cartón / basura",
  otro: "Otra parada",
};
const ESTADO_SALIDA_LABEL = { programada: "Programada", en_ruta: "En ruta", completada: "Completada" } as const;

const TABS = [
  { value: "rol", label: "Rol del día" },
  { value: "rutas", label: "Rutas" },
  { value: "unidades", label: "Unidades" },
] as const;

async function leerError(res: Response, porDefecto: string) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || porDefecto;
}

function TipoRutaBadge({ tipo }: { tipo: TipoRuta }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIPO_RUTA_ESTILO[tipo]}`}>{TIPO_RUTA_LABEL[tipo]}</span>;
}

// ---------------------------------------------------------------------------
// Rol del día
// ---------------------------------------------------------------------------

function SalidaCard({
  salida,
  indice,
  catalogo,
  totalSalidas,
  nombresSalidas,
  onCambiar,
  onMoverPedido,
  onQuitar,
}: {
  salida: Salida;
  indice: number;
  catalogo: Catalogo;
  totalSalidas: number;
  nombresSalidas: string[];
  onCambiar: (cambios: Partial<Salida>, esAjuste?: boolean) => void;
  onMoverPedido: (pedidoId: string, destino: number) => void;
  onQuitar: () => void;
}) {
  const [nuevaParada, setNuevaParada] = useState<{ tipo: TipoParada; descripcion: string }>({ tipo: "recoleccion", descripcion: "" });
  const [agregandoParada, setAgregandoParada] = useState(false);
  const vehiculos = catalogo.vehiculos.filter((v) => v.activo || v._id === salida.vehiculoId);
  const choferes = catalogo.choferes.filter((c) => c.activo || c._id === salida.choferId);
  const vehiculo = catalogo.vehiculos.find((v) => v._id === salida.vehiculoId);
  const faltaFrio = salida.requiereRefrigerado && vehiculo && !vehiculo.refrigerado;

  function agregarParada() {
    if (!nuevaParada.descripcion.trim()) return;
    onCambiar({ paradas: [...salida.paradas, { tipo: nuevaParada.tipo, sucursalId: null, descripcion: nuevaParada.descripcion.trim() }] }, true);
    setNuevaParada({ ...nuevaParada, descripcion: "" });
    setAgregandoParada(false);
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-display text-lg font-bold text-titos-green-900">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {salida.horaSalida}
            </span>
            <span className="font-semibold text-titos-green-900">{salida.nombre}</span>
            <TipoRutaBadge tipo={salida.tipo} />
            {salida.requiereRefrigerado ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-800">
                <Snowflake className="h-3 w-3" aria-hidden="true" /> Refrigerado
              </span>
            ) : null}
            {salida.ajustadaManualmente ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Ajustada a mano</span>
            ) : null}
          </div>
          {salida.motivoSugerencia ? <p className="mt-1 text-xs text-black/45">Sugerencia: {salida.motivoSugerencia}</p> : null}
        </div>
        {!salida.rutaId ? (
          <button onClick={onQuitar} className="text-xs font-medium text-red-600 hover:underline">
            Quitar salida
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FormField label="Unidad">
          <Select value={salida.vehiculoId ?? ""} onChange={(e) => onCambiar({ vehiculoId: e.target.value || null }, true)} icon={Truck}>
            <option value="">— Sin unidad —</option>
            {vehiculos.map((v) => (
              <option key={v._id} value={v._id}>
                {v.nombre}
                {v.refrigerado ? " ❄" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Chofer">
          <Select value={salida.choferId ?? ""} onChange={(e) => onCambiar({ choferId: e.target.value || null }, true)} icon={User}>
            <option value="">— Sin chofer —</option>
            {choferes.map((c) => (
              <option key={c._id} value={c._id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Estado">
          <Select value={salida.estado} onChange={(e) => onCambiar({ estado: e.target.value as Salida["estado"] })}>
            {Object.entries(ESTADO_SALIDA_LABEL).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {faltaFrio ? (
        <p className="flex items-center gap-1 text-xs font-medium text-red-700">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Esta ruta lleva perecedero y la unidad elegida no es refrigerada.
        </p>
      ) : null}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">Recorrido</p>
        {salida.paradas.length === 0 ? (
          <p className="text-sm text-black/40">Sin paradas.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {salida.paradas.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-titos-green-100 text-[11px] font-bold text-titos-green-900">{i + 1}</span>
                <span className={p.tipo === "sucursal" ? "font-medium" : "italic text-black/70"}>
                  {p.tipo === "sucursal" ? (p.nombre ?? catalogo.sucursales.find((s) => s._id === p.sucursalId)?.nombre ?? "Tienda") : `${TIPO_PARADA_LABEL[p.tipo]}: ${p.descripcion}`}
                </span>
                {p.tipo !== "sucursal" ? (
                  <button
                    onClick={() => onCambiar({ paradas: salida.paradas.filter((_, j) => j !== i) }, true)}
                    className="text-black/30 hover:text-red-600"
                    aria-label={`Quitar parada ${p.descripcion}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {agregandoParada ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="w-40 shrink-0">
              <Select
                value={nuevaParada.tipo}
                onChange={(e) => setNuevaParada({ ...nuevaParada, tipo: e.target.value as TipoParada })}
                aria-label="Tipo de parada extra"
              >
                <option value="recoleccion">Recolección</option>
                <option value="basura">Cartón / basura</option>
                <option value="otro">Otra parada</option>
              </Select>
            </div>
            <div className="min-w-40 flex-1">
              <Input
                autoFocus
                value={nuevaParada.descripcion}
                onChange={(e) => setNuevaParada({ ...nuevaParada, descripcion: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && agregarParada()}
                placeholder="Ej. Carne en Bona Prime"
                aria-label="Descripción de la parada extra"
              />
            </div>
            <Button size="sm" onClick={agregarParada} disabled={!nuevaParada.descripcion.trim()}>
              Agregar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAgregandoParada(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <button onClick={() => setAgregandoParada(true)} className="mt-1.5 text-xs font-semibold text-titos-green-700 hover:underline">
            + Parada extra (recolección, cartón…)
          </button>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">Folios ({salida.pedidos.length})</p>
        {salida.pedidos.length === 0 ? (
          <p className="text-sm text-black/40">Sin pedidos asignados.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {salida.pedidos.map((p) => (
              <li key={p._id} className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-black/2 py-0.5 pl-2 pr-1 text-xs">
                <span className="font-semibold">{p.folio}</span>
                <span className="text-black/50">· {p.sucursalNombre}</span>
                {p.vuelta === 2 ? <span className="rounded bg-titos-orange-100 px-1 font-semibold text-titos-orange-700">V2</span> : null}
                <select
                  value={indice}
                  onChange={(e) => onMoverPedido(p._id, Number(e.target.value))}
                  className="ml-1 w-20 rounded border-none bg-transparent text-xs font-semibold text-titos-green-700"
                  aria-label={`Mover folio ${p.folio}`}
                >
                  {Array.from({ length: totalSalidas }, (_, i) => (
                    <option key={i} value={i}>
                      {i === indice ? "Mover…" : `→ ${nombresSalidas[i]}`}
                    </option>
                  ))}
                  <option value={-1}>Quitar de la ruta</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Input value={salida.notas} onChange={(e) => onCambiar({ notas: e.target.value })} placeholder="Notas para el chofer" aria-label="Notas de la salida" />
    </Card>
  );
}

function RolDelDia({ catalogo, tokenPantalla }: { catalogo: Catalogo; tokenPantalla: string | null }) {
  const zona = useZonaHoraria();
  const hoy = fechaEnZona(new Date(), zona);
  const [fecha, setFecha] = useState(hoy);
  const [rol, setRol] = useState<Rol | null>(null);
  const [salidas, setSalidas] = useState<Salida[]>([]);
  const [sinSalida, setSinSalida] = useState<PedidoRol[]>([]);
  const [sucio, setSucio] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [confirmandoRegenerar, setConfirmandoRegenerar] = useState(false);

  const aplicar = useCallback((data: Rol) => {
    setRol(data);
    setSalidas(data.salidas);
    setSinSalida(data.pedidosSinSalida);
    setSucio(false);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch(`/api/operacion/rol?fecha=${fecha}`);
    if (res.ok) aplicar(await res.json());
    else setMensaje({ tipo: "error", texto: await leerError(res, "No se pudo cargar el rol") });
    setCargando(false);
  }, [fecha, aplicar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del rol al cambiar de fecha
    cargar();
  }, [cargar]);

  async function sugerir(soloPedidos: boolean) {
    setConfirmandoRegenerar(false);
    setTrabajando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/rol/sugerir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, soloPedidos }),
    });
    setTrabajando(false);
    if (!res.ok) return setMensaje({ tipo: "error", texto: await leerError(res, "No se pudo generar la sugerencia") });
    const data: Rol = await res.json();
    aplicar(data);
    setMensaje({
      tipo: "ok",
      texto: soloPedidos
        ? `Folios acomodados. ${data.pedidosSinSalida.length ? `${data.pedidosSinSalida.length} siguen sin ruta: asígnalos a mano.` : "Todos los pedidos tienen salida."}`
        : `Rol sugerido con ${data.salidas.length} salida(s). Revísalo y ajusta lo que haga falta.`,
    });
  }

  async function guardar() {
    setTrabajando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/rol", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, salidas: salidas.map(({ pedidos, ...s }) => ({ ...s, pedidoIds: pedidos.map((p) => p._id) })) }),
    });
    setTrabajando(false);
    if (!res.ok) return setMensaje({ tipo: "error", texto: await leerError(res, "No se pudo guardar el rol") });
    aplicar(await res.json());
    setMensaje({ tipo: "ok", texto: "Rol guardado. La pantalla del área operativa ya lo muestra." });
  }

  function cambiar(i: number, cambios: Partial<Salida>, esAjuste = false) {
    setSalidas((prev) => prev.map((s, j) => (j === i ? { ...s, ...cambios, ajustadaManualmente: s.ajustadaManualmente || esAjuste } : s)));
    setSucio(true);
  }

  function moverPedido(origen: number, pedidoId: string, destino: number) {
    const pedido = origen < 0 ? sinSalida.find((p) => p._id === pedidoId) : salidas[origen]?.pedidos.find((p) => p._id === pedidoId);
    if (!pedido || origen === destino) return;
    setSalidas((prev) =>
      prev.map((s, j) => {
        let pedidos = s.pedidos;
        if (j === origen) pedidos = pedidos.filter((p) => p._id !== pedidoId);
        if (j === destino) pedidos = [...pedidos, pedido];
        return pedidos === s.pedidos ? s : { ...s, pedidos, ajustadaManualmente: true };
      })
    );
    setSinSalida((prev) => (origen < 0 ? prev.filter((p) => p._id !== pedidoId) : destino < 0 ? [...prev, pedido] : prev));
    setSucio(true);
  }

  function agregarSalidaExtra() {
    setSalidas((prev) => [
      ...prev,
      {
        rutaId: null,
        nombre: "Salida extra",
        tipo: "especial",
        horaSalida: "12:00",
        duracionMin: 120,
        requiereRefrigerado: false,
        vehiculoId: null,
        choferId: null,
        estado: "programada",
        motivoSugerencia: "",
        ajustadaManualmente: true,
        notas: "",
        paradas: [],
        pedidos: [],
      },
    ]);
    setSucio(true);
  }

  const nombresSalidas = salidas.map((s) => `${s.horaSalida} ${s.nombre}`);
  const conflictos = sucio ? [] : (rol?.conflictos ?? []);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Fecha">
              <Input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className="w-44" />
            </FormField>
            <Button variant="ghost" onClick={() => setFecha(hoy)} disabled={fecha === hoy}>
              Hoy
            </Button>
            <Button variant="ghost" onClick={() => setFecha(sumarDias(hoy, 1))} disabled={fecha === sumarDias(hoy, 1)}>
              Mañana
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tokenPantalla ? (
              <a href={`/pantalla/rutas?t=${encodeURIComponent(tokenPantalla)}`} target="_blank" rel="noreferrer">
                <Button variant="ghost">
                  <span className="inline-flex items-center gap-1.5">
                    <Tv className="h-4 w-4" aria-hidden="true" /> Abrir pantalla
                  </span>
                </Button>
              </a>
            ) : null}
            <Button variant="ghost" onClick={() => sugerir(true)} disabled={trabajando || !rol?.existe || sucio} title={sucio ? "Guarda o descarta tus cambios primero" : undefined}>
              Acomodar pedidos pendientes
            </Button>
            <Button
              variant="secondary"
              onClick={() => (rol?.existe ? setConfirmandoRegenerar(true) : sugerir(false))}
              disabled={trabajando}
            >
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> {rol?.existe ? "Volver a sugerir" : "Generar rol sugerido"}
              </span>
            </Button>
            <Button onClick={guardar} disabled={trabajando || !sucio}>
              {trabajando ? "Guardando..." : "Guardar rol"}
            </Button>
          </div>
        </div>
        {confirmandoRegenerar ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <span>Se va a rehacer el rol de este día y se pierden los ajustes manuales. ¿Continuar?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmandoRegenerar(false)}>
              No
            </Button>
            <Button size="sm" variant="danger" onClick={() => sugerir(false)}>
              Sí, volver a sugerir
            </Button>
          </div>
        ) : null}
        {rol?.existe && rol.actualizadoPorNombre ? (
          <p className="mt-2 text-xs text-black/40">Última modificación: {rol.actualizadoPorNombre}</p>
        ) : null}
        {sucio ? <p className="mt-2 text-xs font-medium text-amber-700">Hay cambios sin guardar.</p> : null}
        {mensaje ? (
          <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`mt-2 text-sm ${mensaje.tipo === "error" ? "text-red-600" : "text-titos-green-700"}`}>
            {mensaje.texto}
          </p>
        ) : null}
      </Card>

      {conflictos.length ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Revisa estos empalmes
          </p>
          <ul className="list-inside list-disc">
            {conflictos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sinSalida.length ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-900">Pedidos listos sin ruta ({sinSalida.length})</p>
          <ul className="flex flex-wrap gap-2">
            {sinSalida.map((p) => (
              <li key={p._id} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white py-0.5 pl-2 pr-1 text-xs">
                <span className="font-semibold">{p.folio}</span>
                <span className="text-black/50">· {p.sucursalNombre}</span>
                {p.vuelta === 2 ? <span className="rounded bg-titos-orange-100 px-1 font-semibold text-titos-orange-700">V2</span> : null}
                <select
                  value={-1}
                  onChange={(e) => moverPedido(-1, p._id, Number(e.target.value))}
                  className="ml-1 w-24 rounded border-none bg-transparent text-xs font-semibold text-titos-green-700"
                  aria-label={`Asignar folio ${p.folio}`}
                  disabled={!salidas.length}
                >
                  <option value={-1}>Mandar a…</option>
                  {salidas.map((s, i) => (
                    <option key={i} value={i}>
                      {nombresSalidas[i]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {cargando ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : salidas.length === 0 ? (
        <EmptyState
          message={
            catalogo.rutas.some((r) => r.activo)
              ? "Todavía no hay rol para este día. Genera la sugerencia: el sistema propone unidad, chofer y folios de cada ruta."
              : "Primero da de alta las rutas y las unidades en las otras pestañas."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {salidas.map((s, i) => (
            <SalidaCard
              key={s._id ?? `nueva-${i}`}
              salida={s}
              indice={i}
              catalogo={catalogo}
              totalSalidas={salidas.length}
              nombresSalidas={nombresSalidas}
              onCambiar={(cambios, esAjuste) => cambiar(i, cambios, esAjuste)}
              onMoverPedido={(pedidoId, destino) => moverPedido(i, pedidoId, destino)}
              onQuitar={() => {
                setSinSalida((prev) => [...prev, ...s.pedidos]);
                setSalidas((prev) => prev.filter((_, j) => j !== i));
                setSucio(true);
              }}
            />
          ))}
        </div>
      )}
      {!cargando && salidas.length ? (
        <Button variant="ghost" onClick={agregarSalidaExtra}>
          <span className="inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" /> Agregar salida extra
          </span>
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catálogo de rutas
// ---------------------------------------------------------------------------

const rutaVacia = (): Omit<Ruta, "_id"> => ({
  nombre: "",
  tipo: "primera_vuelta",
  horaSalida: "07:00",
  duracionMin: 0,
  diasSemana: [...DIAS_SEMANA],
  paradas: [],
  requiereRefrigerado: false,
  vehiculoPreferidoId: null,
  choferResponsableId: null,
  choferSustitutoId: null,
  notas: "",
  activo: true,
});

function RutaModal({ ruta, catalogo, onClose, onGuardada }: { ruta: Ruta | null; catalogo: Catalogo; onClose: () => void; onGuardada: () => void }) {
  const [form, setForm] = useState<Omit<Ruta, "_id">>(() => (ruta ? { ...ruta } : rutaVacia()));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cambiarParada(i: number, cambios: Partial<Parada>) {
    setForm((f) => ({ ...f, paradas: f.paradas.map((p, j) => (j === i ? { ...p, ...cambios } : p)) }));
  }
  function moverParada(i: number, delta: number) {
    setForm((f) => {
      const paradas = [...f.paradas];
      const j = i + delta;
      if (j < 0 || j >= paradas.length) return f;
      [paradas[i], paradas[j]] = [paradas[j], paradas[i]];
      return { ...f, paradas };
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await fetch(ruta ? `/api/operacion/rutas/${ruta._id}` : "/api/operacion/rutas", {
      method: ruta ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (!res.ok) return setError(await leerError(res, "No se pudo guardar la ruta"));
    onGuardada();
  }

  const choferes = catalogo.choferes.filter((c) => c.activo);

  return (
    <Modal
      open
      onClose={onClose}
      title={ruta ? `Editar ruta · ${ruta.nombre}` : "Nueva ruta"}
      icon={RouteIcon}
      size="lg"
      footer={
        <Button onClick={guardar} disabled={guardando || !form.nombre.trim()}>
          {guardando ? "Guardando..." : "Guardar ruta"}
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Nombre">
          <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Troque Grande" />
        </FormField>
        <FormField label="Tipo">
          <Select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoRuta })}>
            {Object.entries(TIPO_RUTA_LABEL).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Hora de salida">
          <Input type="time" value={form.horaSalida} onChange={(e) => setForm({ ...form, horaSalida: e.target.value })} />
        </FormField>
        <FormField label="Duración (min, 0 = la general)">
          <Input type="number" min="0" max="720" value={form.duracionMin} onChange={(e) => setForm({ ...form, duracionMin: Number(e.target.value) || 0 })} />
        </FormField>
        <FormField label="Unidad preferida">
          <Select value={form.vehiculoPreferidoId ?? ""} onChange={(e) => setForm({ ...form, vehiculoPreferidoId: e.target.value || null })}>
            <option value="">— La que esté libre —</option>
            {catalogo.vehiculos.filter((v) => v.activo).map((v) => (
              <option key={v._id} value={v._id}>
                {v.nombre}
                {v.refrigerado ? " ❄" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.requiereRefrigerado} onChange={(e) => setForm({ ...form, requiereRefrigerado: e.target.checked })} />
          Lleva perecedero (solo unidad refrigerada)
        </label>
        <FormField label="Chofer responsable">
          <Select value={form.choferResponsableId ?? ""} onChange={(e) => setForm({ ...form, choferResponsableId: e.target.value || null })}>
            <option value="">— Sin responsable fijo —</option>
            {choferes.map((c) => (
              <option key={c._id} value={c._id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Sustituto">
          <Select value={form.choferSustitutoId ?? ""} onChange={(e) => setForm({ ...form, choferSustitutoId: e.target.value || null })}>
            <option value="">— Rotación —</option>
            {choferes.filter((c) => c._id !== form.choferResponsableId).map((c) => (
              <option key={c._id} value={c._id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </FormField>
      </FormGrid>

      <div className="mt-4">
        <p className="mb-1 text-sm font-medium text-black/70">Días que sale</p>
        <div className="flex flex-wrap gap-2">
          {DIAS_SEMANA.map((d) => (
            <label key={d} className="flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={form.diasSemana.includes(d)}
                onChange={(e) => setForm({ ...form, diasSemana: e.target.checked ? [...form.diasSemana, d] : form.diasSemana.filter((x) => x !== d) })}
              />
              {DIA_LABEL[d]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1 text-sm font-medium text-black/70">Paradas, en orden de recorrido</p>
        <ol className="space-y-2">
          {form.paradas.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-sm font-semibold text-black/40">{i + 1}.</span>
              <Select value={p.tipo} onChange={(e) => cambiarParada(i, { tipo: e.target.value as TipoParada })} className="w-44" aria-label="Tipo de parada">
                {Object.entries(TIPO_PARADA_LABEL).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </Select>
              {p.tipo === "sucursal" ? (
                <Select value={p.sucursalId ?? ""} onChange={(e) => cambiarParada(i, { sucursalId: e.target.value || null })} className="min-w-0 flex-1" aria-label="Tienda">
                  <option value="">— Elige tienda —</option>
                  {catalogo.sucursales.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.nombre}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={p.descripcion} onChange={(e) => cambiarParada(i, { descripcion: e.target.value })} placeholder="Qué se hace y dónde" className="min-w-0 flex-1" aria-label="Descripción" />
              )}
              <button onClick={() => moverParada(i, -1)} disabled={i === 0} className="text-black/40 disabled:opacity-30" aria-label="Subir parada">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button onClick={() => moverParada(i, 1)} disabled={i === form.paradas.length - 1} className="text-black/40 disabled:opacity-30" aria-label="Bajar parada">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button onClick={() => setForm({ ...form, paradas: form.paradas.filter((_, j) => j !== i) })} className="text-black/40 hover:text-red-600" aria-label="Quitar parada">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setForm({ ...form, paradas: [...form.paradas, { tipo: "sucursal", sucursalId: null, descripcion: "" }] })}>
          + Agregar parada
        </Button>
      </div>

      <FormField label="Notas" className="mt-4">
        <Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
      </FormField>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
        Ruta activa
      </label>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function RutasCatalogo({ catalogo, onCambio }: { catalogo: Catalogo; onCambio: () => void }) {
  const [editando, setEditando] = useState<Ruta | "nueva" | null>(null);
  const nombre = (lista: { _id: string; nombre: string }[], id: string | null) => (id ? (lista.find((x) => x._id === id)?.nombre ?? "—") : "—");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-black/50">
          Cada ruta tiene responsable y sustituto. Si ninguno está libre, el sistema rota al chofer con menos salidas. Los choferes se dan de alta en{" "}
          <Link href="/matriz/personal" className="font-medium text-titos-green-700 underline">
            Personal
          </Link>{" "}
          con el puesto &quot;Chofer&quot; o &quot;Repartidor&quot;.
        </p>
        <Button onClick={() => setEditando("nueva")}>Nueva ruta</Button>
      </div>
      {catalogo.rutas.length === 0 ? (
        <EmptyState message="No hay rutas dadas de alta." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  {["Hora", "Ruta", "Días", "Recorrido", "Unidad", "Responsable", "Sustituto", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalogo.rutas.map((r) => (
                  <tr key={r._id} className={`border-b border-black/5 ${r.activo ? "" : "opacity-50"}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{r.horaSalida}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.nombre}</span>
                        <TipoRutaBadge tipo={r.tipo} />
                        {r.requiereRefrigerado ? <Snowflake className="h-3.5 w-3.5 text-cyan-700" aria-label="Refrigerado" /> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-black/60">
                      {r.diasSemana.length === 7 ? "Diario" : r.diasSemana.map((d) => DIA_LABEL[d as (typeof DIAS_SEMANA)[number]]?.slice(0, 3)).join(", ")}
                    </td>
                    <td className="max-w-md px-2 py-1.5 text-xs text-black/60">
                      {r.paradas.map((p) => (p.tipo === "sucursal" ? nombre(catalogo.sucursales, p.sucursalId) : p.descripcion)).join(" → ") || "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{nombre(catalogo.vehiculos, r.vehiculoPreferidoId)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{nombre(catalogo.choferes, r.choferResponsableId)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{nombre(catalogo.choferes, r.choferSustitutoId)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditando(r)}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editando ? (
        <RutaModal
          ruta={editando === "nueva" ? null : editando}
          catalogo={catalogo}
          onClose={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null);
            onCambio();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

function VehiculoModal({ vehiculo, onClose, onGuardado }: { vehiculo: Vehiculo | null; onClose: () => void; onGuardado: () => void }) {
  const [form, setForm] = useState<Omit<Vehiculo, "_id">>(() => vehiculo ?? { nombre: "", tipo: "estaquita", refrigerado: false, placas: "", notas: "", activo: true });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await fetch(vehiculo ? `/api/operacion/vehiculos/${vehiculo._id}` : "/api/operacion/vehiculos", {
      method: vehiculo ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (!res.ok) return setError(await leerError(res, "No se pudo guardar la unidad"));
    onGuardado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={vehiculo ? `Editar · ${vehiculo.nombre}` : "Nueva unidad"}
      icon={Truck}
      footer={
        <Button onClick={guardar} disabled={guardando || !form.nombre.trim()}>
          {guardando ? "Guardando..." : "Guardar unidad"}
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Nombre">
          <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Estaquita 1" />
        </FormField>
        <FormField label="Tipo">
          <Select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Vehiculo["tipo"] })}>
            <option value="estaquita">Camioneta estaquita</option>
            <option value="camion">Camión</option>
          </Select>
        </FormField>
        <FormField label="Placas">
          <Input value={form.placas} onChange={(e) => setForm({ ...form, placas: e.target.value })} />
        </FormField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.refrigerado} onChange={(e) => setForm({ ...form, refrigerado: e.target.checked })} />
          Refrigerada
        </label>
        <FormField label="Notas" className="sm:col-span-2">
          <Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
          Disponible (desmarca si está en taller)
        </label>
      </FormGrid>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function Unidades({ catalogo, onCambio }: { catalogo: Catalogo; onCambio: () => void }) {
  const [editando, setEditando] = useState<Vehiculo | "nueva" | null>(null);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditando("nueva")}>Nueva unidad</Button>
      </div>
      {catalogo.vehiculos.length === 0 ? (
        <EmptyState message="No hay unidades dadas de alta." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {catalogo.vehiculos.map((v) => (
            <Card key={v._id} className={`p-4 ${v.activo ? "" : "opacity-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 font-semibold text-titos-green-900">
                    <Truck className="h-4 w-4" aria-hidden="true" /> {v.nombre}
                  </p>
                  <p className="text-xs text-black/50">
                    {v.tipo === "camion" ? "Camión" : "Estaquita"}
                    {v.placas ? ` · ${v.placas}` : ""}
                    {v.activo ? "" : " · No disponible"}
                  </p>
                </div>
                {v.refrigerado ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-800">
                    <Snowflake className="h-3 w-3" aria-hidden="true" /> Refrigerada
                  </span>
                ) : null}
              </div>
              {v.notas ? <p className="mt-2 text-xs text-black/50">{v.notas}</p> : null}
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditando(v)}>
                Editar
              </Button>
            </Card>
          ))}
        </div>
      )}
      {editando ? (
        <VehiculoModal
          vehiculo={editando === "nueva" ? null : editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onCambio();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RolEntregasManager() {
  const searchParams = useSearchParams();
  const tabInicial = TABS.find((t) => t.value === searchParams.get("tab"))?.value ?? "rol";
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>(tabInicial);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const cargarCatalogo = useCallback(async () => {
    const res = await fetch("/api/operacion/catalogo");
    if (res.ok) setCatalogo(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del catálogo
    cargarCatalogo();
    fetch("/api/operacion/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setToken(d?.pantallaToken ?? null))
      .catch(() => {});
  }, [cargarCatalogo]);

  return (
    <div>
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
      {!catalogo ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : tab === "rol" ? (
        <RolDelDia catalogo={catalogo} tokenPantalla={token} />
      ) : tab === "rutas" ? (
        <RutasCatalogo catalogo={catalogo} onCambio={cargarCatalogo} />
      ) : (
        <Unidades catalogo={catalogo} onCambio={cargarCatalogo} />
      )}
    </div>
  );
}
