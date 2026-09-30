"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, Pagination, Input, Button } from "@/components/ui";

const PAGE_SIZE = 20;

type ProductoStockBajo = {
  _id: string;
  nombre: string;
  existenciaMatriz: number;
  unidad: string;
  stockMinimo: number;
  diferencia: number;
};

type EnlaceProveedor = {
  proveedorId: { _id: string; nombre: string } | string;
  costoUnitario: number;
  esPrincipal: boolean;
  activo: boolean;
};

export function StockBajoCard({ productos }: { productos: ProductoStockBajo[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [agregando, setAgregando] = useState<Record<string, boolean>>({});
  const [mensajes, setMensajes] = useState<Record<string, string>>({});

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [productos, busqueda]);

  const totalPages = Math.max(1, Math.ceil(productosFiltrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPages);
  const productosPagina = productosFiltrados.slice((paginaActual - 1) * PAGE_SIZE, paginaActual * PAGE_SIZE);

  function actualizarBusqueda(value: string) {
    setBusqueda(value);
    setPage(1);
  }

  async function agregarAOrden(producto: ProductoStockBajo) {
    setMensajes((prev) => ({ ...prev, [producto._id]: "" }));
    setAgregando((prev) => ({ ...prev, [producto._id]: true }));

    const provRes = await fetch(`/api/productos/${producto._id}/proveedores`);
    const enlaces: EnlaceProveedor[] = provRes.ok ? await provRes.json() : [];
    const activos = enlaces.filter((e) => e.activo);

    if (activos.length === 0) {
      setAgregando((prev) => ({ ...prev, [producto._id]: false }));
      setMensajes((prev) => ({ ...prev, [producto._id]: "Sin proveedor asignado — agrégalo en Productos" }));
      return;
    }

    const elegido = activos.find((e) => e.esPrincipal) ?? activos[0];
    const proveedorId = typeof elegido.proveedorId === "string" ? elegido.proveedorId : elegido.proveedorId._id;
    const proveedorNombre = typeof elegido.proveedorId === "string" ? elegido.proveedorId : elegido.proveedorId.nombre;
    const cantidad = Math.max(1, producto.diferencia);

    const res = await fetch("/api/ordenes-compra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedorId,
        productoId: producto._id,
        cantidadOrdenada: cantidad,
      }),
    });

    setAgregando((prev) => ({ ...prev, [producto._id]: false }));

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMensajes((prev) => ({ ...prev, [producto._id]: data.error || "No se pudo agregar a la orden" }));
      return;
    }

    setMensajes((prev) => ({ ...prev, [producto._id]: `Agregado a orden de ${proveedorNombre} (${cantidad})` }));
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold text-titos-green-900">Alertas de stock bajo</h2>
      {productos.length === 0 ? (
        <EmptyState message="Ningún producto por debajo de su mínimo." />
      ) : (
        <>
          <Input
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => actualizarBusqueda(e.target.value)}
            className="mb-3"
          />
          {productosFiltrados.length === 0 ? (
            <EmptyState message="Ningún producto coincide con la búsqueda." />
          ) : (
            <>
              <ul className="divide-y divide-black/5">
                {productosPagina.map((p) => (
                  <li key={p._id} className="flex flex-col gap-1.5 py-1.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate" title={p.nombre}>
                        <span className="font-medium">{p.nombre}</span>
                        <span className="ml-2 text-xs text-black/40">Sugerido a pedir: {p.diferencia} {p.unidad}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="whitespace-nowrap text-red-600">
                        {p.existenciaMatriz} {p.unidad} (mín. {p.stockMinimo})
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => agregarAOrden(p)}
                        disabled={agregando[p._id] || p.diferencia <= 0}
                        title={p.diferencia <= 0 ? "Este producto no tiene stock máximo configurado" : undefined}
                      >
                        {agregando[p._id] ? "Agregando..." : "+ Orden"}
                      </Button>
                    </div>
                    {mensajes[p._id] ? (
                      <p className="w-full text-xs text-titos-green-700">{mensajes[p._id]}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Pagination
                page={paginaActual}
                totalPages={totalPages}
                totalItems={productosFiltrados.length}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}
