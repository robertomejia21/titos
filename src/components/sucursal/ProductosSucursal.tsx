"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Input, Select, EmptyState, Pagination } from "@/components/ui";

const PAGE_SIZE = 20;

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  alias: string[];
  linea: string;
  categoria: string;
  unidad: "pieza" | "kg";
  requierePesaje: boolean;
  precioVenta: number;
};

type InventarioRow = {
  productoId: string;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
};

type Categoria = { _id: string; nombre: string };

export function ProductosSucursal({ initialQuery = "" }: { initialQuery?: string }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [inventario, setInventario] = useState<Map<string, InventarioRow>>(new Map());
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState(initialQuery);
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [soloConStock, setSoloConStock] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    Promise.all([
      fetch("/api/productos").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/inventario-sucursal").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/categorias").then((r) => (r.ok ? r.json() : [])),
    ]).then(([prods, inv, cats]: [Producto[], InventarioRow[], Categoria[]]) => {
      setProductos(prods);
      setInventario(new Map(inv.map((i) => [i.productoId, i])));
      setCategorias(cats);
      setLoading(false);
    });
  }, []);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const coincideBusqueda =
        !q ||
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.alias ?? []).some((a) => a.toLowerCase().includes(q));
      const coincideCategoria = !categoriaFiltro || p.categoria === categoriaFiltro;
      const coincideStock = !soloConStock || (inventario.get(p._id)?.stockActual ?? 0) > 0;
      return coincideBusqueda && coincideCategoria && coincideStock;
    });
  }, [productos, inventario, busqueda, categoriaFiltro, soloConStock]);

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

  function actualizarSoloConStock(value: boolean) {
    setSoloConStock(value);
    setPage(1);
  }

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold text-titos-green-900">
          Existencia en sucursal ({productosFiltrados.length})
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:w-56">
            <Input
              placeholder="Buscar por nombre, SKU o alias..."
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
          <label className="flex shrink-0 items-center gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              checked={soloConStock}
              onChange={(e) => actualizarSoloConStock(e.target.checked)}
            />
            Solo con stock
          </label>
        </div>
      </div>
      {loading ? (
        <p className="py-8 text-center text-sm text-black/50">Cargando productos...</p>
      ) : productosFiltrados.length === 0 ? (
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
                  <th className="px-2 py-1.5 text-xs font-medium">Código</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Categoría</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Unidad</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Stock</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Mín</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Máx</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Dif.</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Precio</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.map((p) => {
                  const inv = inventario.get(p._id);
                  const stockActual = inv?.stockActual ?? 0;
                  const stockMinimo = inv?.stockMinimo ?? 0;
                  const stockMaximo = inv?.stockMaximo ?? 0;
                  const diferencia = stockMaximo - stockActual;
                  const bajoMinimo = stockActual <= stockMinimo && stockMaximo > 0;
                  return (
                    <tr key={p._id} className="border-b border-black/5">
                      <td
                        className="max-w-[16rem] truncate px-2 py-1.5 font-medium"
                        title={(p.alias ?? []).length > 0 ? `${p.nombre}\nalias: ${p.alias.join(", ")}` : p.nombre}
                      >
                        {p.nombre}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{p.sku}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">
                        {p.categoria.replaceAll("_", " ")}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{p.unidad}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 font-medium ${bajoMinimo ? "text-red-600" : ""}`}>
                        {stockActual}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{stockMinimo}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{stockMaximo}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${diferencia < 0 ? "text-red-600" : "text-black/60"}`}>
                        {diferencia}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">${p.precioVenta.toFixed(2)}</td>
                    </tr>
                  );
                })}
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
  );
}
