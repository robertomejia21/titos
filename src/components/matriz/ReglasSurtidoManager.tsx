"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, Tv } from "lucide-react";
import { Button, Card, FormField, Input } from "@/components/ui";
import { CRITERIO_LABEL, type CriterioProrrateo } from "@/lib/prorrateo";
import { SkeletonTarjetas } from "@/components/Skeleton";

type Config = {
  criterioProrrateo: CriterioProrrateo;
  prioridadSucursales: { sucursalId: string; prioridad: number }[];
  segundaVuelta: { automatica: boolean; diasVigencia: number };
  temporadaAlta: { meses: number[]; factorMinimos: number };
  faltantesDiarios: {
    activo: boolean;
    hora: string;
    destinatariosAlmacen: string[];
    enviarAProveedores: boolean;
    segmentos?: SegmentoFaltantes[];
    generalSoloResto?: boolean;
  };
  traspasos?: { mostrarMontos: boolean };
  nivelador?: { ventanaDias: 30 | 60; diasCobertura: number };
  tiemposRuta?: { minutosPorParada: number; holguraMin: number };
  duracionRutaMin: number;
  pantallaToken?: string;
  sucursales: { _id: string; nombre: string }[];
};

type SegmentoFaltantes = { nombre: string; categorias: string[]; destinatarios: string[] };
/** El grupo como se edita: los WhatsApp van en un solo campo de texto. */
type GrupoEditable = { nombre: string; categorias: string[]; destinatarios: string };

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const AYUDA_CRITERIO: Record<CriterioProrrateo, string> = {
  caja_completa:
    "Cuando no alcanza, cada tienda recibe cajas cerradas en proporción a lo que pidió; las piezas sueltas van a la tienda con más prioridad. Evita reempacar. Lo que falte sale en la segunda vuelta.",
  proporcional: "Cada tienda recibe la misma fracción de lo que pidió (si alcanza para la mitad, todas reciben la mitad).",
  prioridad: "Se llena tienda por tienda en el orden de prioridad; las últimas de la lista esperan la segunda vuelta.",
};

const separarNumeros = (texto: string) => texto.split(/[,\n]/).map((d) => d.trim()).filter(Boolean);

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="font-semibold text-titos-green-900">{titulo}</h2>
      {descripcion ? <p className="mb-3 mt-0.5 text-sm text-black/50">{descripcion}</p> : <div className="mb-3" />}
      {children}
    </Card>
  );
}

export function ReglasSurtidoManager() {
  const [config, setConfig] = useState<Config | null>(null);
  const [orden, setOrden] = useState<string[]>([]);
  const [almacen, setAlmacen] = useState("");
  const [grupos, setGrupos] = useState<GrupoEditable[]>([]);
  // Tienda que se está arrastrando en la lista de prioridad.
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  function aplicar(data: Config) {
    setConfig(data);
    const priorizadas = [...data.prioridadSucursales].sort((a, b) => a.prioridad - b.prioridad).map((p) => String(p.sucursalId));
    const activas = new Set(data.sucursales.map((s) => s._id));
    setOrden([...priorizadas.filter((id) => activas.has(id)), ...data.sucursales.map((s) => s._id).filter((id) => !priorizadas.includes(id))]);
    setAlmacen((data.faltantesDiarios?.destinatariosAlmacen ?? []).join(", "));
    setGrupos((data.faltantesDiarios?.segmentos ?? []).map((g) => ({ ...g, destinatarios: g.destinatarios.join(", ") })));
  }

  useEffect(() => {
    fetch("/api/operacion/config")
      .then((r) => r.json())
      .then(aplicar)
      .catch(() => setMensaje({ tipo: "error", texto: "No se pudo cargar la configuración" }));
    fetch("/api/categorias")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: { nombre: string }[]) => setCategorias(lista.map((c) => c.nombre)))
      .catch(() => setCategorias([]));
  }, []);

  if (!config) return mensaje?.texto ? <p className="text-sm text-black/50">{mensaje.texto}</p> : <SkeletonTarjetas cantidad={6} />;

  const set = (cambios: Partial<Config>) => setConfig({ ...config, ...cambios });
  const nombre = (id: string) => config.sucursales.find((s) => s._id === id)?.nombre ?? "Tienda";

  function mover(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    const copia = [...orden];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setOrden(copia);
  }

  /** Arrastrar y soltar: saca la tienda de su lugar y la pone donde se soltó. */
  function soltarEn(destino: number) {
    if (arrastrando === null || arrastrando === destino) return setArrastrando(null);
    const copia = [...orden];
    const [tienda] = copia.splice(arrastrando, 1);
    copia.splice(destino, 0, tienda);
    setOrden(copia);
    setArrastrando(null);
  }

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criterioProrrateo: config.criterioProrrateo,
        prioridadSucursales: orden.map((sucursalId) => ({ sucursalId })),
        segundaVuelta: config.segundaVuelta,
        temporadaAlta: config.temporadaAlta,
        faltantesDiarios: {
          ...config.faltantesDiarios,
          destinatariosAlmacen: separarNumeros(almacen),
          segmentos: grupos.map((g) => ({ nombre: g.nombre, categorias: g.categorias, destinatarios: separarNumeros(g.destinatarios) })),
        },
        traspasos: { mostrarMontos: config.traspasos?.mostrarMontos === true },
        nivelador: { ventanaDias: config.nivelador?.ventanaDias ?? 30, diasCobertura: config.nivelador?.diasCobertura ?? 2 },
        tiemposRuta: { minutosPorParada: config.tiemposRuta?.minutosPorParada ?? 0, holguraMin: config.tiemposRuta?.holguraMin ?? 20 },
        duracionRutaMin: config.duracionRutaMin,
      }),
    });
    setGuardando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMensaje({ tipo: "error", texto: data.error || "No se pudo guardar" });
    aplicar({ ...data, sucursales: config.sucursales });
    setMensaje({ tipo: "ok", texto: "Reglas guardadas. El Nivelador y la segunda vuelta ya las usan." });
  }

  async function nuevaLlave() {
    const res = await fetch("/api/operacion/config/token", { method: "POST" });
    if (res.ok && config) setConfig({ ...config, pantallaToken: (await res.json()).pantallaToken });
  }

  const urlPantalla = config.pantallaToken && typeof window !== "undefined" ? `${window.location.origin}/pantalla/rutas?t=${encodeURIComponent(config.pantallaToken)}` : "";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Seccion titulo="Cómo se reparte lo que no alcanza" descripcion="Lo usan el Nivelador y la segunda vuelta. Se puede cambiar cuando quieran.">
        <div className="space-y-2">
          {(Object.keys(CRITERIO_LABEL) as CriterioProrrateo[]).map((c) => (
            <label key={c} className={`block cursor-pointer rounded-lg border p-3 ${config.criterioProrrateo === c ? "border-titos-green-500 bg-titos-green-100/50" : "border-black/10"}`}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="criterio" checked={config.criterioProrrateo === c} onChange={() => set({ criterioProrrateo: c })} />
                {CRITERIO_LABEL[c]}
              </span>
              <span className="mt-1 block pl-6 text-sm text-black/55">{AYUDA_CRITERIO[c]}</span>
            </label>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Prioridad entre tiendas" descripcion="La primera se atiende primero cuando hay que decidir quién se lleva la última caja o pieza. Arrastra para reordenar.">
        <ol className="space-y-1.5">
          {orden.map((id, i) => (
            <li
              key={id}
              draggable
              onDragStart={() => setArrastrando(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => soltarEn(i)}
              onDragEnd={() => setArrastrando(null)}
              className={`flex cursor-grab items-center gap-2 rounded-lg border px-3 py-1.5 ${arrastrando === i ? "border-titos-green-500 bg-titos-green-100/50 opacity-60" : "border-black/10"}`}
            >
              <GripVertical className="h-4 w-4 text-black/30" aria-hidden="true" />
              <span className="w-6 font-bold text-titos-green-700">{i + 1}</span>
              <span className="flex-1 text-sm font-medium">{nombre(id)}</span>
              <button onClick={() => mover(i, -1)} disabled={i === 0} className="text-black/40 disabled:opacity-30" aria-label={`Subir ${nombre(id)}`}>
                <ArrowUp className="h-4 w-4" />
              </button>
              <button onClick={() => mover(i, 1)} disabled={i === orden.length - 1} className="text-black/40 disabled:opacity-30" aria-label={`Bajar ${nombre(id)}`}>
                <ArrowDown className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
      </Seccion>

      <Seccion titulo="Patrón de consumo" descripcion="El Nivelador sugiere cuánto mandar a cada tienda según lo que vendió. Se ve en la vista por producto.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Ventana de ventas">
            <select
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              value={config.nivelador?.ventanaDias ?? 30}
              onChange={(e) => set({ nivelador: { ventanaDias: Number(e.target.value) as 30 | 60, diasCobertura: config.nivelador?.diasCobertura ?? 2 } })}
            >
              <option value={30}>Mensual (últimos 30 días)</option>
              <option value={60}>Bimestral (últimos 60 días)</option>
            </select>
          </FormField>
          <FormField label="Días que debe cubrir lo que se manda">
            <Input
              type="number"
              min="1"
              max="14"
              value={config.nivelador?.diasCobertura ?? 2}
              onChange={(e) => set({ nivelador: { ventanaDias: config.nivelador?.ventanaDias ?? 30, diasCobertura: Number(e.target.value) || 1 } })}
            />
          </FormField>
        </div>
      </Seccion>

      <Seccion titulo="Segunda vuelta" descripcion="Completa los pedidos que quedaron cortos en cuanto llega mercancía.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.segundaVuelta.automatica}
            onChange={(e) => set({ segundaVuelta: { ...config.segundaVuelta, automatica: e.target.checked } })}
          />
          Armar el complemento automáticamente al recibir una orden de compra o una entrada de inventario
        </label>
        <FormField label="Completar pedidos de hasta (días atrás)" className="mt-3 max-w-xs">
          <Input
            type="number"
            min="1"
            max="30"
            value={config.segundaVuelta.diasVigencia}
            onChange={(e) => set({ segundaVuelta: { ...config.segundaVuelta, diasVigencia: Number(e.target.value) || 1 } })}
          />
        </FormField>
      </Seccion>

      <Seccion titulo="Temporada alta" descripcion="En estos meses los mínimos suben: se usa el mínimo de temporada del producto o, si no tiene, el mínimo normal por el factor.">
        <div className="flex flex-wrap gap-1.5">
          {MESES.map((m, i) => {
            const mes = i + 1;
            const activo = config.temporadaAlta.meses.includes(mes);
            return (
              <button
                key={m}
                onClick={() =>
                  set({ temporadaAlta: { ...config.temporadaAlta, meses: activo ? config.temporadaAlta.meses.filter((x) => x !== mes) : [...config.temporadaAlta.meses, mes] } })
                }
                className={`rounded-lg border px-2.5 py-1 text-sm font-medium ${activo ? "border-titos-orange-500 bg-titos-orange-100 text-titos-orange-700" : "border-black/10 text-black/50"}`}
                aria-pressed={activo}
              >
                {m}
              </button>
            );
          })}
        </div>
        <FormField label="Factor de mínimos (1.5 = 50% más)" className="mt-3 max-w-xs">
          <Input
            type="number"
            min="1"
            max="5"
            step="0.1"
            value={config.temporadaAlta.factorMinimos}
            onChange={(e) => set({ temporadaAlta: { ...config.temporadaAlta, factorMinimos: Number(e.target.value) || 1 } })}
          />
        </FormField>
      </Seccion>

      <Seccion titulo="Lista diaria de faltantes" descripcion="Se manda por WhatsApp a cada proveedor con sus diferencias, y el resumen completo a Compras (Configuración → Alertas) y al almacén.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.faltantesDiarios.activo} onChange={(e) => set({ faltantesDiarios: { ...config.faltantesDiarios, activo: e.target.checked } })} />
          Mandar la lista automáticamente todos los días
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.faltantesDiarios.enviarAProveedores}
            onChange={(e) => set({ faltantesDiarios: { ...config.faltantesDiarios, enviarAProveedores: e.target.checked } })}
          />
          Incluir el mensaje a cada proveedor
        </label>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Hora de envío">
            <Input type="time" value={config.faltantesDiarios.hora} onChange={(e) => set({ faltantesDiarios: { ...config.faltantesDiarios, hora: e.target.value } })} />
          </FormField>
          <FormField label="WhatsApp del almacén (separados por coma)">
            <Input value={almacen} onChange={(e) => setAlmacen(e.target.value)} placeholder="6861234567, 6867654321" />
          </FormField>
        </div>

        <div className="mt-4 border-t border-black/5 pt-3">
          <p className="text-sm font-medium text-black/70">Grupos por categoría</p>
          <p className="mb-2 text-xs text-black/50">
            A cada grupo le llega solo lo de sus categorías. Ejemplo: &quot;Frutas y verduras&quot; para Alonso y &quot;Abarrotes&quot; para Compras.
          </p>
          <div className="space-y-3">
            {grupos.map((g, i) => {
              const cambiar = (cambios: Partial<GrupoEditable>) => setGrupos(grupos.map((x, j) => (j === i ? { ...x, ...cambios } : x)));
              return (
                <div key={i} className="rounded-lg border border-black/10 p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <FormField label="Nombre del grupo">
                      <Input value={g.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Frutas y verduras" />
                    </FormField>
                    <FormField label="WhatsApp (separados por coma)">
                      <Input value={g.destinatarios} onChange={(e) => cambiar({ destinatarios: e.target.value })} placeholder="6861234567" />
                    </FormField>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {categorias.map((c) => {
                      const activa = g.categorias.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => cambiar({ categorias: activa ? g.categorias.filter((x) => x !== c) : [...g.categorias, c] })}
                          className={`rounded-lg border px-2 py-0.5 text-xs font-medium ${activa ? "border-titos-green-500 bg-titos-green-100 text-titos-green-700" : "border-black/10 text-black/50"}`}
                          aria-pressed={activa}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => setGrupos(grupos.filter((_, j) => j !== i))} className="mt-2 inline-flex items-center gap-1 text-xs text-red-600">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Quitar grupo
                  </button>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setGrupos([...grupos, { nombre: "", categorias: [], destinatarios: "" }])}>
            <span className="inline-flex items-center gap-1">
              <Plus className="h-4 w-4" aria-hidden="true" /> Agregar grupo
            </span>
          </Button>
          {grupos.length ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.faltantesDiarios.generalSoloResto !== false}
                onChange={(e) => set({ faltantesDiarios: { ...config.faltantesDiarios, generalSoloResto: e.target.checked } })}
              />
              Compras y el almacén reciben solo lo que no es de ningún grupo
            </label>
          ) : null}
        </div>
      </Seccion>

      <Seccion titulo="Montos en traspasos" descripcion="Los traspasos a tiendas se muestran e imprimen sin precios ni totales.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.traspasos?.mostrarMontos === true}
            onChange={(e) => set({ traspasos: { mostrarMontos: e.target.checked } })}
          />
          Mostrar montos a todos
        </label>
        <p className="mt-2 text-xs text-black/50">
          Apagado, solo los ven los roles con el permiso &quot;Ver e imprimir los montos de los traspasos&quot; (se asigna en Usuarios y roles).
        </p>
      </Seccion>

      <Seccion titulo="Rutas y pantalla del área operativa" descripcion="La pantalla no inicia sesión: entra con esta llave. Si se filtra, genera otra y la TV anterior deja de ver el rol.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Duración típica de una ruta (min)">
            <Input type="number" min="30" max="720" value={config.duracionRutaMin} onChange={(e) => set({ duracionRutaMin: Number(e.target.value) || 150 })} />
          </FormField>
          <FormField label="Minutos por parada (0 = no estimar)">
            <Input
              type="number"
              min="0"
              max="180"
              value={config.tiemposRuta?.minutosPorParada ?? 0}
              onChange={(e) => set({ tiemposRuta: { minutosPorParada: Number(e.target.value) || 0, holguraMin: config.tiemposRuta?.holguraMin ?? 20 } })}
            />
          </FormField>
          <FormField label="Holgura por ruta (min)">
            <Input
              type="number"
              min="0"
              max="240"
              value={config.tiemposRuta?.holguraMin ?? 20}
              onChange={(e) => set({ tiemposRuta: { minutosPorParada: config.tiemposRuta?.minutosPorParada ?? 0, holguraMin: Number(e.target.value) || 0 } })}
            />
          </FormField>
        </div>
        <p className="mt-1 text-xs text-black/50">Si una ruta no tiene duración propia, se estima con paradas × minutos más la holgura; sin minutos por parada se usa la duración típica.</p>
        {config.pantallaToken ? (
          <div className="mt-3 space-y-2">
            <Input readOnly value={urlPantalla} onFocus={(e) => e.target.select()} aria-label="Dirección de la pantalla" />
            <div className="flex flex-wrap gap-2">
              <a href={urlPantalla} target="_blank" rel="noreferrer">
                <Button variant="ghost">
                  <span className="inline-flex items-center gap-1.5">
                    <Tv className="h-4 w-4" aria-hidden="true" /> Abrir pantalla
                  </span>
                </Button>
              </a>
              <Button variant="danger" onClick={nuevaLlave}>
                Generar llave nueva
              </Button>
            </div>
          </div>
        ) : null}
      </Seccion>

      <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar reglas"}
        </Button>
        {mensaje ? (
          <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`text-sm ${mensaje.tipo === "error" ? "text-red-600" : "text-titos-green-700"}`}>
            {mensaje.texto}
          </p>
        ) : null}
      </div>
    </div>
  );
}
