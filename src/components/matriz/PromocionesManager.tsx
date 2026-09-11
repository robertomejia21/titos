"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Card, Button } from "@/components/ui";
import { coincideBusqueda } from "@/lib/busqueda";
import { validarPromocion, type BorradorPromocion, type PromocionGuardada } from "@/lib/promociones";
import { formatFechaHora } from "@/lib/zonasHorarias";

type Producto = { _id: string; nombre: string; sku: string; categoria: string; unidad: "kg" | "pieza" };
type Datos = { promociones: PromocionGuardada[]; productos: Producto[]; sucursales: { _id: string; nombre: string }[] };
const campo = "min-h-11 w-full rounded-lg border border-black/50 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-green-800";
const boton = "min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-800";
const nuevo = (): BorradorPromocion => ({ nombre: "", tipo: "porcentaje", valor: 0, alcance: "productos", productos: [], categorias: [], sucursales: [], unidad: "todas", inicio: "", fin: "", estado: "borrador" });
function alternar(lista: string[], id: string) { return lista.includes(id) ? lista.filter((v) => v !== id) : [...lista, id]; }
function fecha(dia: string) { return dia.split("-").reverse().join("/"); }
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-black/80">{label}{children}</label>;
}

function Editor({ inicial, datos, cerrar, guardada }: { inicial: PromocionGuardada | null; datos: Datos; cerrar: () => void; guardada: (p: PromocionGuardada) => void }) {
  const [form, setForm] = useState<BorradorPromocion>(inicial ?? nuevo);
  const [valor, setValor] = useState(inicial ? String(inicial.valor) : "");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titulo.current?.focus(); }, []);
  function set<K extends keyof BorradorPromocion>(key: K, value: BorradorPromocion[K]) { setForm((f) => ({ ...f, [key]: value })); }
  const productos = datos.productos.filter((p) => form.unidad === "todas" || form.unidad === p.unidad);
  const categorias = [...new Set(productos.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, "es"));
  const opciones = form.alcance === "productos" ? productos.map((p) => ({ id: p._id, label: `${p.nombre} · ${p.sku} · ${p.unidad}` })) : categorias.map((c) => ({ id: c, label: c }));
  const seleccion = form.alcance === "productos" ? form.productos : form.categorias;
  const filtradas = opciones.filter((p) => coincideBusqueda(p.label, buscar));
  const seleccionadas = seleccion.map((id) => ({ id, label: opciones.find((o) => o.id === id)?.label ?? datos.productos.find((p) => p._id === id)?.nombre ?? `${id} (no disponible)` }));
  const sucursalesNoDisponibles = form.sucursales.filter((id) => !datos.sucursales.some((s) => s._id === id));

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError("");
    let body;
    try { body = validarPromocion({ ...form, valor: Number(valor) }); } catch (e) { setError(e instanceof Error ? e.message : "Revisa el formulario."); return; }
    setSaving(true);
    try {
      const res = await fetch(inicial ? `/api/promociones/${inicial._id}` : "/api/promociones", {
        method: inicial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(inicial ? { revision: inicial.revision } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el borrador.");
      guardada(data);
    } catch (e) { setError(e instanceof Error ? e.message : "No hay conexión. Revisa tu conexión antes de volver a guardar."); }
    finally { setSaving(false); }
  }

  return <Card>
    <h2 ref={titulo} tabIndex={-1} className="mb-4 text-lg font-semibold text-titos-green-900">{inicial ? "Editar promoción" : "Nueva promoción"}</h2>
    <form onSubmit={guardar}>
      <fieldset disabled={saving} className="space-y-5">
        <Field label="Nombre de la promoción"><input className={campo} required maxLength={120} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej. Descuento de fin de semana" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de descuento"><select className={campo} value={form.tipo} onChange={(e) => set("tipo", e.target.value as BorradorPromocion["tipo"])}><option value="porcentaje">Porcentaje (%)</option><option value="monto">Descontar pesos ($)</option></select></Field>
          <Field label={form.tipo === "porcentaje" ? "Porcentaje de descuento" : "Pesos a descontar por pieza o kg"}><input className={campo} type="number" required min="0.01" max={form.tipo === "porcentaje" ? 100 : 1000000} step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        </div>
        {form.tipo === "monto" && <p className="text-sm text-black/75">El monto se descuenta del precio de cada pieza o de cada kilogramo, según la unidad del producto.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aplicar a"><select className={campo} value={form.alcance} onChange={(e) => { set("alcance", e.target.value as BorradorPromocion["alcance"]); setBuscar(""); }}><option value="productos">Productos seleccionados</option><option value="categorias">Categorías seleccionadas</option></select></Field>
          <Field label="Unidad de los productos"><select className={campo} value={form.unidad} onChange={(e) => set("unidad", e.target.value as BorradorPromocion["unidad"])}><option value="todas">Piezas y kilos</option><option value="pieza">Solo piezas</option><option value="kg">Solo kilos</option></select></Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{form.alcance === "productos" ? "Productos" : "Categorías"} ({seleccion.length} seleccionados)</legend>
          <input className={campo} aria-label="Buscar productos o categorías" placeholder={form.alcance === "productos" ? "Buscar por nombre o código" : "Buscar categoría"} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-black/50 p-2">
            {filtradas.slice(0, 30).map((o) => <label key={o.id} className="flex min-h-11 items-center gap-3 px-2 text-sm"><input className="h-5 w-5 accent-green-800" type="checkbox" checked={seleccion.includes(o.id)} onChange={() => set(form.alcance, alternar(seleccion, o.id))} />{o.label}</label>)}
            {!filtradas.length && <p className="p-2 text-sm">No hay resultados con esta búsqueda y unidad.</p>}
          </div>
          {filtradas.length > 30 && <p className="text-sm text-black/75">Se muestran 30 de {filtradas.length}. Escribe el nombre o código para ubicar otro producto.</p>}
          {!!seleccionadas.length && <details><summary className="cursor-pointer py-3 text-sm font-medium">Ver selección completa ({seleccionadas.length})</summary><ul>{seleccionadas.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 text-sm"><span>{p.label}</span><Button type="button" variant="ghost" className={boton} aria-label={`Quitar ${p.label}`} onClick={() => set(form.alcance, seleccion.filter((id) => id !== p.id))}>Quitar</Button></li>)}</ul></details>}
          {form.alcance === "categorias" && <p className="text-sm text-black/75">La selección abarca los productos activos de esas categorías y de la unidad elegida.</p>}
        </fieldset>
        <fieldset><legend className="mb-2 text-sm font-semibold">Sucursales ({form.sucursales.length} seleccionadas)</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">{datos.sucursales.map((s) => <label key={s._id} className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5 accent-green-800" type="checkbox" checked={form.sucursales.includes(s._id)} onChange={() => set("sucursales", alternar(form.sucursales, s._id))} />{s.nombre}</label>)}</div>
          {!datos.sucursales.length && <p className="text-sm">No hay sucursales activas disponibles.</p>}
          {sucursalesNoDisponibles.map((id) => <div className="flex items-center gap-2 text-sm" key={id}>Sucursal no disponible<Button className={boton} variant="ghost" type="button" onClick={() => set("sucursales", form.sucursales.filter((s) => s !== id))}>Quitar</Button></div>)}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha de inicio"><input className={campo} required type="date" value={form.inicio} onChange={(e) => set("inicio", e.target.value)} /></Field>
          <Field label="Fecha final"><input className={campo} required type="date" min={form.inicio || undefined} value={form.fin} onChange={(e) => set("fin", e.target.value)} /></Field>
        </div>
        <p className="text-sm text-black/75">Vigencia prevista: días completos, con la hora local de cada sucursal. Guardar las fechas todavía no activa la promoción.</p>
        {inicial && <Field label="Estado"><select className={campo} value={form.estado} onChange={(e) => set("estado", e.target.value as BorradorPromocion["estado"])}><option value="borrador">Borrador</option><option value="archivado">Archivado</option></select></Field>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3"><Button className={boton} type="button" variant="ghost" onClick={cerrar}>Cancelar</Button><Button className={boton} type="submit">{saving ? "Guardando..." : form.estado === "archivado" ? "Guardar como archivado" : "Guardar borrador"}</Button></div>
      </fieldset>
    </form>
  </Card>;
}

export function PromocionesManager() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [editando, setEditando] = useState<PromocionGuardada | null | undefined>(undefined);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("borrador");
  const [sucursal, setSucursal] = useState("");
  const [orden, setOrden] = useState("recientes");
  const nuevaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/promociones", { signal: controller.signal }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error || "No se pudieron cargar las promociones.");
      setDatos(await r.json());
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message || "No se pudieron cargar las promociones."); });
    return () => controller.abort();
  }, []);
  function cerrar() { setEditando(undefined); setTimeout(() => nuevaRef.current?.focus(), 0); }
  if (!datos) return <Card>{error ? <div role="alert"><p>{error}</p><Button className={`mt-3 ${boton}`} onClick={() => window.location.reload()}>Volver a intentar</Button></div> : <p role="status">Cargando promociones...</p>}</Card>;
  const visibles = datos.promociones.filter((p) => (!estado || p.estado === estado) && (!sucursal || p.sucursales.includes(sucursal)) && coincideBusqueda(p.nombre, busqueda)).sort((a, b) => orden === "nombre" ? a.nombre.localeCompare(b.nombre, "es") : orden === "inicio" ? a.inicio.localeCompare(b.inicio) : b.updatedAt.localeCompare(a.updatedAt));
  return <div className="space-y-4">
    <div className="rounded-lg border border-amber-700 bg-amber-50 p-4 text-sm text-amber-950"><strong>Preparación de promociones.</strong> Puedes guardar y editar borradores. Todavía no se aplican descuentos en caja. Las combinaciones 2x1 y las reglas de aplicación siguen pendientes.</div>
    {mensaje && <p role="status" className="text-sm font-medium text-green-900">{mensaje}</p>}
    {editando !== undefined ? <Editor inicial={editando} datos={datos} cerrar={cerrar} guardada={(p) => {
      setDatos({ ...datos, promociones: [p, ...datos.promociones.filter((v) => v._id !== p._id)] });
      setEstado(p.estado); setSucursal(""); setBusqueda(""); setMensaje(p.estado === "archivado" ? "Promoción archivada." : "Borrador guardado. No se aplica en caja."); cerrar();
    }} /> : <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-titos-green-900">Borradores de promociones</h2><button ref={nuevaRef} className={`${boton} rounded-lg bg-titos-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-titos-green-700`} onClick={() => { setEditando(null); setMensaje(""); }}>Nueva promoción</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Buscar promoción"><input className={campo} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre de la promoción" /></Field>
        <Field label="Estado"><select className={campo} value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option value="borrador">Borradores</option><option value="archivado">Archivados</option></select></Field>
        <Field label="Sucursal"><select className={campo} value={sucursal} onChange={(e) => setSucursal(e.target.value)}><option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s._id} value={s._id}>{s.nombre}</option>)}</select></Field>
        <Field label="Ordenar por"><select className={campo} value={orden} onChange={(e) => setOrden(e.target.value)}><option value="recientes">Última modificación</option><option value="nombre">Nombre A–Z</option><option value="inicio">Fecha de inicio</option></select></Field>
      </div>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm text-black/75">{visibles.length} de {datos.promociones.length} promociones</p><Button className={boton} variant="ghost" onClick={() => { setBusqueda(""); setEstado(""); setSucursal(""); setOrden("recientes"); }}>Limpiar filtros</Button></div>
      {!visibles.length ? <p className="py-6 text-sm text-black/75">{datos.promociones.length ? "No hay promociones con estos filtros." : "Todavía no hay promociones. Crea un borrador para preparar el primer descuento."}</p> : <ul className="divide-y divide-black/15">{visibles.map((p) => <li key={p._id} className="flex flex-wrap items-start justify-between gap-3 py-4">
        <div className="min-w-0 flex-1"><h3 className="break-words font-semibold text-titos-green-900">{p.nombre}</h3><p className="mt-1 text-sm">{p.tipo === "porcentaje" ? `${p.valor}% de descuento` : `$${p.valor.toFixed(2)} menos por pieza o kg`} · {p.alcance === "productos" ? `${p.productos.length} productos` : p.categorias.join(", ")} · {p.unidad === "todas" ? "Piezas y kilos" : p.unidad === "kg" ? "Solo kilos" : "Solo piezas"}</p><p className="mt-1 text-sm text-black/75">Del {fecha(p.inicio)} al {fecha(p.fin)} · {p.sucursales.map((id) => datos.sucursales.find((s) => s._id === id)?.nombre ?? "Sucursal no disponible").join(", ")}</p><p className="mt-1 text-xs text-black/75">{p.estado === "archivado" ? "Archivado" : "Borrador"} · No se aplica en caja · Última edición: {p.actualizadoPor}, {formatFechaHora(p.updatedAt)}</p></div><Button className={boton} variant="ghost" aria-label={`Editar ${p.nombre}`} onClick={() => { setEditando(p); setMensaje(""); }}>Editar</Button>
      </li>)}</ul>}
    </Card>}
  </div>;
}
