"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Star } from "lucide-react";
import { Button, Card, EmptyState, Input, Pagination } from "@/components/ui";
import { enPresentacion } from "@/lib/minimos";

type Fila = {
  _id: string;
  sku: string;
  nombre: string;
  linea: string;
  unidad: "pieza" | "kg";
  existenciaMatriz: number;
  stockMinimo: number;
  stockMaximo: number;
  minimoTemporadaAlta: number;
  piezasPorCaja: number;
  cajasPorTarima: number;
  esClave: boolean;
  vidaUtilDias: number;
  minimoVigente: number;
  maximoVigente: number;
  bajoMinimo: boolean;
  aResurtir: number;
  necesidadPendiente: boolean;
};

type Respuesta = { fecha: string; temporadaAlta: boolean; items: Fila[]; total: number; bajoMinimo: number; truncado: boolean };
type Editable = Pick<Fila, "stockMinimo" | "stockMaximo" | "minimoTemporadaAlta" | "piezasPorCaja" | "cajasPorTarima" | "vidaUtilDias" | "esClave">;

const PAGINA = 50;
const CAMPOS_EN_CAJAS: (keyof Editable)[] = ["stockMinimo", "stockMaximo", "minimoTemporadaAlta"];

export function MinimosManager() {
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtros, setFiltros] = useState({ clave: true, bajo: false, perecederos: false });
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cambios, setCambios] = useState<Record<string, Partial<Editable>>>({});
  const [enCajas, setEnCajas] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGINA) });
    if (busqueda) params.set("q", busqueda);
    if (filtros.clave) params.set("clave", "1");
    if (filtros.bajo) params.set("bajo", "1");
    if (filtros.perecederos) params.set("perecederos", "1");
    const res = await fetch(`/api/operacion/minimos?${params}`);
    if (res.ok) setDatos(await res.json());
  }, [page, busqueda, filtros]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar filtros o página
    cargar();
  }, [cargar]);

  useEffect(() => {
    const id = setTimeout(() => {
      setBusqueda(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const valor = (f: Fila, campo: keyof Editable) => (cambios[f._id]?.[campo] ?? f[campo]) as number | boolean;
  const caja = (f: Fila) => Number(valor(f, "piezasPorCaja")) || 0;

  function editar(f: Fila, campo: keyof Editable, entrada: string | boolean) {
    let v: number | boolean = entrada as boolean;
    if (typeof entrada === "string") {
      const n = Number(entrada);
      v = Number.isFinite(n) && n >= 0 ? n : 0;
      if (enCajas && CAMPOS_EN_CAJAS.includes(campo) && caja(f) > 1) v = Math.round(n * caja(f) * 1000) / 1000;
    }
    setCambios((prev) => ({ ...prev, [f._id]: { ...prev[f._id], [campo]: v } }));
  }

  function mostrar(f: Fila, campo: keyof Editable) {
    const v = Number(valor(f, campo));
    return enCajas && CAMPOS_EN_CAJAS.includes(campo) && caja(f) > 1 ? Math.round((v / caja(f)) * 100) / 100 : v;
  }

  async function guardar() {
    setTrabajando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/minimos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cambios: Object.entries(cambios).map(([productoId, c]) => ({ productoId, ...c })) }),
    });
    setTrabajando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMensaje({ tipo: "error", texto: data.error || "No se pudieron guardar los cambios" });
    setCambios({});
    setMensaje({ tipo: "ok", texto: `${data.actualizados} producto(s) actualizados.` });
    cargar();
  }

  async function mandarACompras() {
    setTrabajando(true);
    setMensaje(null);
    const res = await fetch("/api/operacion/minimos/necesidades", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setTrabajando(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMensaje({ tipo: "error", texto: data.error || "No se pudo mandar a Compras" });
    setMensaje({
      tipo: "ok",
      texto: data.creadas ? `Se mandaron ${data.creadas} producto(s) a Necesidades por ordenar, en cajas completas hasta el máximo.` : "No hay productos nuevos bajo mínimo: lo que falta ya está en Compras.",
    });
    cargar();
  }

  const pendientes = Object.keys(cambios).length;
  const celda = "px-2 py-1.5";
  // El Input trae w-full: el ancho se fija en el contenedor para que la tabla
  // no aplaste los campos.
  const numero = (f: Fila, campo: keyof Editable, etiqueta: string, ancho = "w-20") => (
    <div className={`${ancho} ml-auto`}>
      <Input
        type="number"
        min="0"
        step="any"
        value={mostrar(f, campo)}
        onChange={(e) => editar(f, campo, e.target.value)}
        className="px-2 py-1 text-right"
        aria-label={`${etiqueta} de ${f.nombre}`}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-black/50">Bajo mínimo en esta vista</p>
          <p className="mt-1 text-3xl font-bold text-red-600">{datos?.bajoMinimo ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-black/50">Productos en la vista</p>
          <p className="mt-1 text-3xl font-bold text-titos-green-700">{datos?.total ?? "—"}</p>
        </Card>
        <Card className={`p-4 ${datos?.temporadaAlta ? "border-titos-orange-500 bg-titos-orange-100/40" : ""}`}>
          <p className="text-sm text-black/50">Temporada</p>
          <p className="mt-1 text-xl font-bold text-titos-green-900">{datos ? (datos.temporadaAlta ? "Alta: mínimos aumentados" : "Normal") : "—"}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-56 flex-1">
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, SKU o línea" />
          </div>
          {(
            [
              ["clave", "Solo productos clave"],
              ["bajo", "Solo bajo mínimo"],
              ["perecederos", "Solo perecederos"],
            ] as const
          ).map(([k, etiqueta]) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={filtros[k]}
                onChange={(e) => {
                  setFiltros({ ...filtros, [k]: e.target.checked });
                  setPage(1);
                }}
              />
              {etiqueta}
            </label>
          ))}
          <div className="flex overflow-hidden rounded-lg border border-black/10 text-sm" role="group" aria-label="Unidad de captura">
            <button onClick={() => setEnCajas(true)} className={`px-3 py-1.5 ${enCajas ? "bg-titos-green-600 text-white" : ""}`} aria-pressed={enCajas}>
              Capturar en cajas
            </button>
            <button onClick={() => setEnCajas(false)} className={`px-3 py-1.5 ${!enCajas ? "bg-titos-green-600 text-white" : ""}`} aria-pressed={!enCajas}>
              En piezas / kg
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={guardar} disabled={!pendientes || trabajando}>
            {pendientes ? `Guardar cambios (${pendientes})` : "Guardar cambios"}
          </Button>
          <Button variant="secondary" onClick={mandarACompras} disabled={trabajando || pendientes > 0} title={pendientes ? "Guarda primero los cambios" : undefined}>
            Mandar bajo mínimo a Compras
          </Button>
          {pendientes ? (
            <Button variant="ghost" onClick={() => setCambios({})}>
              Descartar
            </Button>
          ) : null}
          {mensaje ? (
            <p role={mensaje.tipo === "error" ? "alert" : "status"} className={`text-sm ${mensaje.tipo === "error" ? "text-red-600" : "text-titos-green-700"}`}>
              {mensaje.texto}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-black/45">
          {enCajas
            ? "Mínimo, máximo y mínimo de temporada se capturan en cajas en los productos que tienen piezas por caja; en los demás, en su unidad."
            : "Mínimo, máximo y mínimo de temporada se capturan en piezas o kg."}{" "}
          Mín. temporada en 0 = se usa el mínimo normal por el factor de temporada. Vida útil en 0 = no se controla su rotación.
        </p>
      </Card>

      {!datos ? (
        <p className="text-sm text-black/50">Cargando...</p>
      ) : datos.items.length === 0 ? (
        <EmptyState message={filtros.clave ? "No hay productos clave con estos filtros. Quita el filtro o marca con ★ los que se vigilan a diario." : "No hay productos con estos filtros."} />
      ) : (
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs text-black/50">
                  <th className={celda} aria-label="Clave" />
                  <th className={celda}>Producto</th>
                  <th className={`${celda} text-right`}>Existencia</th>
                  <th className={`${celda} text-right`} title="Piezas o kg por caja">Unid./caja</th>
                  <th className={`${celda} text-right`}>Cajas/tarima</th>
                  <th className={`${celda} text-right`}>Mínimo</th>
                  <th className={`${celda} text-right`}>Máximo</th>
                  <th className={`${celda} text-right`}>Mín. temporada</th>
                  <th className={`${celda} text-right`}>Vida útil (días)</th>
                  <th className={celda}>Mínimo hoy</th>
                  <th className={celda}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((f) => {
                  const clave = Boolean(valor(f, "esClave"));
                  return (
                    <tr key={f._id} className={`border-b border-black/5 ${cambios[f._id] ? "bg-amber-50/60" : ""}`}>
                      <td className={celda}>
                        <button onClick={() => editar(f, "esClave", !clave)} aria-label={clave ? `Quitar ${f.nombre} de productos clave` : `Marcar ${f.nombre} como clave`} aria-pressed={clave}>
                          <Star className={`h-4 w-4 ${clave ? "fill-amber-400 text-amber-500" : "text-black/20"}`} />
                        </button>
                      </td>
                      <td className={`${celda} max-w-[18rem]`}>
                        <p className="truncate font-medium" title={f.nombre}>
                          {f.nombre}
                        </p>
                        <p className="truncate text-xs text-black/40">
                          {f.sku}
                          {f.linea ? ` · ${f.linea}` : ""}
                        </p>
                      </td>
                      <td className={`${celda} whitespace-nowrap text-right text-xs`}>{enPresentacion(f.existenciaMatriz, { ...f, piezasPorCaja: caja(f) })}</td>
                      <td className={`${celda} text-right`}>{numero(f, "piezasPorCaja", "Unidades por caja", "w-16")}</td>
                      <td className={`${celda} text-right`}>{numero(f, "cajasPorTarima", "Cajas por tarima", "w-16")}</td>
                      <td className={`${celda} text-right`}>{numero(f, "stockMinimo", "Mínimo")}</td>
                      <td className={`${celda} text-right`}>{numero(f, "stockMaximo", "Máximo")}</td>
                      <td className={`${celda} text-right`}>{numero(f, "minimoTemporadaAlta", "Mínimo de temporada")}</td>
                      <td className={`${celda} text-right`}>{numero(f, "vidaUtilDias", "Vida útil", "w-16")}</td>
                      <td className={`${celda} whitespace-nowrap text-xs`}>{f.minimoVigente > 0 ? enPresentacion(f.minimoVigente, f) : "—"}</td>
                      <td className={`${celda} min-w-40 text-xs`}>
                        {f.bajoMinimo ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Bajo mínimo</span>
                        ) : f.minimoVigente > 0 ? (
                          <span className="rounded-full bg-titos-green-100 px-2 py-0.5 font-semibold text-titos-green-700">OK</span>
                        ) : (
                          <span className="text-black/40">Sin mínimo</span>
                        )}
                        {f.bajoMinimo ? (
                          <p className="mt-0.5 text-black/50">{f.necesidadPendiente ? "Ya está en Compras" : `Pedir ${enPresentacion(f.aResurtir, f)}`}</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(datos.total / PAGINA))} totalItems={datos.total} pageSize={PAGINA} onChange={setPage} />
        </Card>
      )}
    </div>
  );
}
