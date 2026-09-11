"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Select, EmptyState, Pagination, Modal, FormGrid, FormField } from "@/components/ui";
import { Package, Barcode, Tag, Tags, Scale, DollarSign, Boxes, AlertTriangle, ArrowUpToLine, MapPin, X } from "lucide-react";
import { ProductoProveedoresModal } from "@/components/matriz/ProductoProveedoresModal";

import { FISCAL_INICIAL, type FiscalProducto } from "@/lib/fiscalProducto";

const PAGE_SIZE = 20;

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  alias: string[];
  linea: string;
  categoria: string;
  area?: string;
  fiscal?: FiscalProducto;
  anaquel: string;
  unidad: "pieza" | "kg";
  requierePesaje: boolean;
  precioCompra: number;
  precioVenta: number;
  existenciaMatriz: number;
  stockMinimo: number;
  stockMaximo: number;
  activo: boolean;
};

type Linea = { _id: string; nombre: string };
type Categoria = { _id: string; nombre: string };

const emptyForm = {
  sku: "",
  nombre: "",
  linea: "",
  categoria: "",
  area: "",
  anaquel: "",
  unidad: "pieza" as "pieza" | "kg",
  requierePesaje: false,
  precioCompra: "",
  precioVenta: "",
  existenciaMatriz: "",
  stockMinimo: "",
  stockMaximo: "",
};

function formDesdeProducto(p: Producto) {
  return {
    sku: p.sku,
    nombre: p.nombre,
    linea: p.linea,
    categoria: p.categoria,
    area: p.area ?? "",
    anaquel: p.anaquel ?? "",
    unidad: p.unidad,
    requierePesaje: p.requierePesaje,
    precioCompra: String(p.precioCompra),
    precioVenta: String(p.precioVenta),
    existenciaMatriz: String(p.existenciaMatriz),
    stockMinimo: String(p.stockMinimo),
    stockMaximo: String(p.stockMaximo),
  };
}

function ProductoFormModal({
  producto,
  lineas,
  categorias,
  onClose,
  onGuardado,
}: {
  producto: Producto | null;
  lineas: Linea[];
  categorias: Categoria[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const editando = producto != null;
  const [form, setForm] = useState(producto ? formDesdeProducto(producto) : emptyForm);
  const [fiscal, setFiscal] = useState<FiscalProducto>(producto?.fiscal ?? { ...FISCAL_INICIAL, precioImpuestos: producto ? "pendiente" : "sin_impuestos" });
  const [alias, setAlias] = useState<string[]>(producto?.alias ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function agregarAlias() {
    const valor = aliasInput.trim();
    if (!valor || alias.some((a) => a.toLowerCase() === valor.toLowerCase())) {
      setAliasInput("");
      return;
    }
    setAlias((prev) => [...prev, valor]);
    setAliasInput("");
  }

  function quitarAlias(idx: number) {
    setAlias((prev) => prev.filter((_, i) => i !== idx));
  }

  async function guardar() {
    setError(null);
    setSaving(true);

    const body = {
      ...form,
      fiscal,
      alias,
      precioCompra: Number(form.precioCompra) || 0,
      precioVenta: Number(form.precioVenta) || 0,
      existenciaMatriz: Number(form.existenciaMatriz) || 0,
      stockMinimo: Number(form.stockMinimo) || 0,
      stockMaximo: Number(form.stockMaximo) || 0,
    };

    const res = editando
      ? await fetch(`/api/productos/${producto._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/productos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el producto");
      return;
    }

    onGuardado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? `Editar producto — ${producto.nombre}` : "Nuevo producto"}
      icon={Package}
      size="lg"
      footer={
        <Button onClick={guardar} disabled={saving || !form.sku || !form.nombre || !form.categoria}>
          {saving ? "Guardando..." : editando ? "Guardar cambios" : "Agregar producto"}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="SKU">
            <Input
              icon={Barcode}
              required
              disabled={editando}
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </FormField>
          <FormField label="Nombre">
            <Input icon={Package} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </FormField>
          <FormField label="Línea (marca)">
            <Select icon={Tags} value={form.linea} onChange={(e) => setForm({ ...form, linea: e.target.value })}>
              <option value="">Sin línea</option>
              {lineas.map((l) => (
                <option key={l._id} value={l.nombre}>
                  {l.nombre}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Categoría">
            <Select icon={Tag} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
              <option value="">Selecciona una categoría</option>
              {categorias.map((c) => (
                <option key={c._id} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Área comercial (para promociones)">
            <Input aria-label="Área comercial" maxLength={100} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Ej. Abarrotes, carnicería o frutas" />
          </FormField>
          <FormField label="Anaquel (ubicación en CEDIS matriz)">
            <Input
              icon={MapPin}
              value={form.anaquel}
              onChange={(e) => setForm({ ...form, anaquel: e.target.value })}
              placeholder="Ej. A-03-2, Pasillo 4 nivel 1..."
            />
          </FormField>
          <FormField label="Unidad">
            <Select icon={Scale} value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value as "pieza" | "kg" })}>
              <option value="pieza">Pieza</option>
              <option value="kg">Kilogramo</option>
            </Select>
          </FormField>
          <FormField label="Precio de compra (a proveedor)">
            <Input icon={DollarSign} type="number" step="0.01" value={form.precioCompra} onChange={(e) => setForm({ ...form, precioCompra: e.target.value })} />
          </FormField>
          <FormField label="Precio de venta (a sucursales)">
            <Input icon={DollarSign} type="number" step="0.01" value={form.precioVenta} onChange={(e) => setForm({ ...form, precioVenta: e.target.value })} />
          </FormField>
          <FormField label="Existencia inicial">
            <Input icon={Boxes} type="number" value={form.existenciaMatriz} onChange={(e) => setForm({ ...form, existenciaMatriz: e.target.value })} />
          </FormField>
          <FormField label="Stock mínimo (alerta)">
            <Input icon={AlertTriangle} type="number" value={form.stockMinimo} onChange={(e) => setForm({ ...form, stockMinimo: e.target.value })} />
          </FormField>
          <FormField label="Stock máximo">
            <Input icon={ArrowUpToLine} type="number" value={form.stockMaximo} onChange={(e) => setForm({ ...form, stockMaximo: e.target.value })} />
          </FormField>
        </FormGrid>

        <section className="space-y-3 rounded-lg border border-amber-700 bg-amber-50 p-4">
          <h3 className="font-semibold">Datos fiscales del producto</h3>
          <p className="text-sm text-amber-950">Registro en preparación: estos campos todavía no cambian los cobros ni el timbrado. Falta confirmar el ejemplo de impuestos y conectar el cálculo.</p>
          <FormGrid>
            <FormField label="IVA"><Select aria-label="IVA del producto" value={fiscal.iva} onChange={(e) => setFiscal({ ...fiscal, iva: e.target.value as FiscalProducto["iva"] })}><option value="pendiente">Pendiente de confirmar</option><option value="exento">Exento</option><option value="0">0%</option><option value="8">8%</option><option value="16">16%</option></Select></FormField>
            <FormField label="Precio e impuestos"><Select aria-label="Precio e impuestos" value={fiscal.precioImpuestos} onChange={(e) => setFiscal({ ...fiscal, precioImpuestos: e.target.value as FiscalProducto["precioImpuestos"] })}><option value="pendiente">Pendiente de confirmar</option><option value="sin_impuestos">Precio sin impuestos (se agregan)</option><option value="incluidos">Precio con impuestos incluidos</option></Select></FormField>
            <FormField label="IEPS"><Select aria-label="Tipo de IEPS" value={fiscal.iepsTipo} onChange={(e) => setFiscal({ ...fiscal, iepsTipo: e.target.value as FiscalProducto["iepsTipo"] })}><option value="pendiente">Pendiente de confirmar</option><option value="no_aplica">No aplica</option><option value="porcentaje">Porcentaje (%)</option><option value="cuota">Cuota por unidad ($)</option></Select></FormField>
            <FormField label={fiscal.iepsTipo === "cuota" ? "Cuota IEPS por pieza o kg" : "Tasa IEPS (%)"}><Input aria-label="Valor de IEPS" type="number" min="0" step="0.0001" disabled={["pendiente", "no_aplica"].includes(fiscal.iepsTipo)} value={fiscal.iepsValor} onChange={(e) => setFiscal({ ...fiscal, iepsValor: Number(e.target.value) })} /></FormField>
            <FormField label="Clave de producto SAT"><Input aria-label="Clave de producto SAT" inputMode="numeric" maxLength={8} value={fiscal.claveProdServ} onChange={(e) => setFiscal({ ...fiscal, claveProdServ: e.target.value })} placeholder="8 dígitos; vacío si está pendiente" /></FormField>
          </FormGrid>
        </section>
        <FormField label="Alias (otros nombres por los que se conoce el producto)">
          <div className="flex gap-2">
            <Input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregarAlias();
                }
              }}
              placeholder="Ej. Coca chica, refresco 355ml..."
            />
            <Button type="button" variant="ghost" onClick={agregarAlias}>
              Agregar
            </Button>
          </div>
          {alias.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {alias.map((a, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-xs text-black/70"
                >
                  {a}
                  <button type="button" onClick={() => quitarAlias(idx)} className="text-black/40 hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </FormField>

        <label className="flex items-center gap-2 text-sm text-black/70">
          <input
            type="checkbox"
            checked={form.requierePesaje}
            onChange={(e) => setForm({ ...form, requierePesaje: e.target.checked })}
          />
          Requiere pesaje (perecedero)
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function ProductosManager({ initialQuery = "", initialCreate = false }: { initialQuery?: string; initialCreate?: boolean }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [total, setTotal] = useState(0);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState(initialQuery);
  const [busquedaDebounced, setBusquedaDebounced] = useState(initialQuery);
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [orden, setOrden] = useState<"nombre" | "anaquel">("nombre");
  const [page, setPage] = useState(1);
  const [creando, setCreando] = useState(initialCreate);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [proveedoresModal, setProveedoresModal] = useState<Producto | null>(null);

  // Espera a que el usuario deje de teclear antes de disparar la búsqueda en el servidor.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  // El catálogo puede tener miles de productos: se pagina y filtra en el
  // servidor en vez de mandar todo al navegador en cada carga.
  const cargar = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (busquedaDebounced) params.set("q", busquedaDebounced);
    if (categoriaFiltro) params.set("categoria", categoriaFiltro);
    if (orden === "anaquel") params.set("orden", "anaquel");

    const res = await fetch(`/api/productos?${params.toString()}`);
    if (res.ok) {
      const data: { items: Producto[]; total: number } = await res.json();
      setProductos(data.items);
      setTotal(data.total);
    }
    setLoading(false);
  }, [page, busquedaDebounced, categoriaFiltro, orden]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga desde el servidor cuando cambian página, búsqueda o filtro
    cargar();
  }, [cargar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- vuelve a la página 1 cuando cambia la búsqueda, el filtro o el orden
    setPage(1);
  }, [busquedaDebounced, categoriaFiltro, orden]);

  useEffect(() => {
    fetch("/api/lineas")
      .then((r) => (r.ok ? r.json() : []))
      .then(setLineas);
    fetch("/api/categorias")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategorias);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function actualizarBusqueda(value: string) {
    setBusqueda(value);
  }

  function actualizarCategoriaFiltro(value: string) {
    setCategoriaFiltro(value);
  }

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-titos-green-900">Catálogo ({total})</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-56">
              <Input
                placeholder="Buscar por nombre, SKU, alias o anaquel..."
                value={busqueda}
                onChange={(e) => actualizarBusqueda(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-44">
              <Select value={categoriaFiltro} onChange={(e) => actualizarCategoriaFiltro(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categorias.map((c) => (
                  <option key={c._id} value={c.nombre}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-44">
              <Select value={orden} onChange={(e) => setOrden(e.target.value as "nombre" | "anaquel")}>
                <option value="nombre">Ordenar por nombre</option>
                <option value="anaquel">Ordenar por anaquel</option>
              </Select>
            </div>
            <Button className="shrink-0" onClick={() => setCreando(true)}>
              + Nuevo producto
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : total === 0 ? (
          <EmptyState
            message={
              !busquedaDebounced && !categoriaFiltro
                ? "Todavía no hay productos en el catálogo."
                : "Ningún producto coincide con la búsqueda o el filtro."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 whitespace-nowrap text-black/50">
                    <th className="py-2 pr-2">Línea</th>
                    <th className="py-2 pr-2">Categoría</th>
                    <th className="py-2 pr-2">Código</th>
                    <th className="sticky left-0 z-10 bg-white py-2 pr-2">Producto</th>
                    <th className="py-2 pr-2">Anaquel</th>
                    <th className="py-2 pr-2">Unidad</th>
                    <th className="py-2 pr-2">Stock</th>
                    <th className="py-2 pr-2">Mín</th>
                    <th className="py-2 pr-2">Máx</th>
                    <th className="py-2 pr-2">Dif.</th>
                    <th className="py-2 pr-2">Costo</th>
                    <th className="py-2 pr-2">Público</th>
                    <th className="py-2 pr-2">Tot. costo</th>
                    <th className="py-2 pr-2">Tot. público</th>
                    <th className="py-2 pr-2">Pesaje</th>
                    <th className="sticky right-0 z-10 bg-white py-2 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p) => {
                    const diferencia = p.stockMaximo - p.existenciaMatriz;
                    const totalCosto = p.existenciaMatriz * p.precioCompra;
                    const totalPublico = p.existenciaMatriz * p.precioVenta;
                    return (
                      <tr key={p._id} className="border-b border-black/5 whitespace-nowrap">
                        <td className="py-2 pr-2 text-black/60">{p.linea || "—"}</td>
                        <td className="py-2 pr-2 text-black/60">{p.categoria}</td>
                        <td className="py-2 pr-2 text-black/50">{p.sku}</td>
                        <td className="sticky left-0 z-10 w-55 max-w-55 overflow-hidden bg-white py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => setEditando(p)}
                            className="block max-w-full truncate text-left font-medium text-titos-green-900 hover:underline"
                            title={p.nombre}
                          >
                            {p.nombre}
                          </button>
                          {p.alias?.length > 0 ? (
                            <p className="max-w-full truncate text-xs text-black/40" title={p.alias.join(", ")}>
                              alias: {p.alias.join(", ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2">
                          {p.anaquel ? (
                            <span className="rounded bg-titos-green-900/10 px-1.5 py-0.5 font-mono text-xs text-titos-green-900">
                              {p.anaquel}
                            </span>
                          ) : (
                            <span className="text-black/30">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-black/60">{p.unidad}</td>
                        <td className="py-2 pr-2">{p.existenciaMatriz}</td>
                        <td className="py-2 pr-2 text-black/60">{p.stockMinimo}</td>
                        <td className="py-2 pr-2 text-black/60">{p.stockMaximo}</td>
                        <td className={`py-2 pr-2 ${diferencia < 0 ? "text-red-600" : "text-black/60"}`}>{diferencia}</td>
                        <td className="py-2 pr-2 text-black/60">${p.precioCompra.toFixed(2)}</td>
                        <td className="py-2 pr-2 text-black/60">${p.precioVenta.toFixed(2)}</td>
                        <td className="py-2 pr-2 text-black/60">${totalCosto.toFixed(2)}</td>
                        <td className="py-2 pr-2 text-black/60">${totalPublico.toFixed(2)}</td>
                        <td className="py-2 pr-2 text-black/60">{p.requierePesaje ? "Sí" : "—"}</td>
                        <td className="sticky right-0 z-10 bg-white py-2 pr-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" onClick={() => setEditando(p)}>
                              Editar
                            </Button>
                            <Button variant="ghost" onClick={() => setProveedoresModal(p)}>
                              Proveedores
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      {creando ? (
        <ProductoFormModal
          producto={null}
          lineas={lineas}
          categorias={categorias}
          onClose={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {editando ? (
        <ProductoFormModal
          producto={editando}
          lineas={lineas}
          categorias={categorias}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      ) : null}

      {proveedoresModal ? (
        <ProductoProveedoresModal
          productoId={proveedoresModal._id}
          productoNombre={proveedoresModal.nombre}
          onClose={() => setProveedoresModal(null)}
        />
      ) : null}
    </div>
  );
}
