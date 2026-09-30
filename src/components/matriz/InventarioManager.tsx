"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, EmptyState, Pagination, Modal, FormGrid, FormField } from "@/components/ui";
import { Warehouse, Hash, Scale } from "lucide-react";
import { ProductoCombobox } from "@/components/ProductoCombobox";

const PAGE_SIZE = 20;

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  categoria: string;
  anaquel: string;
  unidad: "pieza" | "kg";
  requierePesaje: boolean;
  existenciaMatriz: number;
};

function RegistrarEntradaModal({
  productos,
  onClose,
  onRegistrada,
}: {
  productos: Producto[];
  onClose: () => void;
  onRegistrada: () => void;
}) {
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [pesoKg, setPesoKg] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productoSeleccionado = useMemo(
    () => productos.find((p) => p._id === productoId),
    [productos, productoId]
  );

  async function registrar() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/inventario/entrada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productoId,
        cantidad: Number(cantidad),
        pesoKg: pesoKg ? Number(pesoKg) : undefined,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo registrar la entrada");
      return;
    }

    onRegistrada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar entrada de proveedor"
      icon={Warehouse}
      size="lg"
      footer={
        <Button onClick={registrar} disabled={saving || !productoId || !cantidad}>
          {saving ? "Guardando..." : "Registrar entrada"}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormField label="Producto">
          <ProductoCombobox productos={productos} value={productoId} onChange={setProductoId} />
        </FormField>
        <FormGrid>
          <FormField label={productoSeleccionado ? `Cantidad en ${productoSeleccionado.unidad}` : "Cantidad"}>
            <Input icon={Hash} type="number" min="1" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </FormField>
          {productoSeleccionado?.requierePesaje ? (
            <FormField label="Peso real en kg (báscula)">
              <Input icon={Scale} type="number" step="0.01" min="0.01" required value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} />
            </FormField>
          ) : null}
        </FormGrid>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

type Categoria = { _id: string; nombre: string };

export function InventarioManager() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [page, setPage] = useState(1);
  const [registrando, setRegistrando] = useState(false);

  async function cargar() {
    const res = await fetch("/api/productos");
    if (res.ok) setProductos(await res.json());
  }

  async function cargarCategorias() {
    const res = await fetch("/api/categorias");
    if (res.ok) setCategorias(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
    cargarCategorias();
  }, []);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const coincideNombre =
        !q ||
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.anaquel ?? "").toLowerCase().includes(q);
      const coincideCategoria = !categoriaFiltro || p.categoria === categoriaFiltro;
      return coincideNombre && coincideCategoria;
    });
  }, [productos, busqueda, categoriaFiltro]);

  const totalPages = Math.max(1, Math.ceil(productosFiltrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPages);
  const productosPagina = productosFiltrados.slice((paginaActual - 1) * PAGE_SIZE, paginaActual * PAGE_SIZE);

  function actualizarBusqueda(value: string) {
    setBusqueda(value);
    setPage(1);
  }

  function actualizarCategoriaFiltro(value: string) {
    setCategoriaFiltro(value);
    setPage(1);
  }

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-titos-green-900">Existencia actual en matriz ({productosFiltrados.length})</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-56">
              <Input
                placeholder="Buscar por nombre, SKU o anaquel..."
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
            <Button className="shrink-0" onClick={() => setRegistrando(true)}>
              + Registrar entrada
            </Button>
          </div>
        </div>
        {productosFiltrados.length === 0 ? (
          <EmptyState
            message={
              productos.length === 0
                ? "No hay productos en el catálogo todavía."
                : "Ningún producto coincide con la búsqueda o el filtro."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="px-2 py-1.5 text-xs font-medium">Producto</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Anaquel</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Categoría</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Existencia</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Pesaje</th>
                  </tr>
                </thead>
                <tbody>
                  {productosPagina.map((p) => (
                    <tr key={p._id} className="border-b border-black/5">
                      <td className="max-w-[16rem] truncate px-2 py-1.5 font-medium" title={p.nombre}>{p.nombre}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {p.anaquel ? (
                          <span className="rounded bg-titos-green-900/10 px-2 py-0.5 font-mono text-xs text-titos-green-900">
                            {p.anaquel}
                          </span>
                        ) : (
                          <span className="text-black/30">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">{p.categoria.replaceAll("_", " ")}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {p.existenciaMatriz} {p.unidad}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/50">{p.requierePesaje ? "Sí" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paginaActual}
              totalPages={totalPages}
              totalItems={productosFiltrados.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      {registrando ? (
        <RegistrarEntradaModal
          productos={productos}
          onClose={() => setRegistrando(false)}
          onRegistrada={() => {
            setRegistrando(false);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
