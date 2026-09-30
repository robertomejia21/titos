"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select, Modal, EmptyState, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Truck } from "lucide-react";

type Proveedor = { _id: string; nombre: string };

type Enlace = {
  _id: string;
  proveedorId: { _id: string; nombre: string } | string;
  costo: number;
  ivaPct: number;
  iepsPct: number;
  costoUnitario: number;
  esPrincipal: boolean;
  activo: boolean;
};

export function ProductoProveedoresModal({
  productoId,
  productoNombre,
  onClose,
}: {
  productoId: string;
  productoNombre: string;
  onClose: () => void;
}) {
  const [enlaces, setEnlaces] = useState<Enlace[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);

  const [proveedorId, setProveedorId] = useState("");
  const [costo, setCosto] = useState("");
  const [ivaPct, setIvaPct] = useState("0");
  const [iepsPct, setIepsPct] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    const [enlRes, provRes] = await Promise.all([
      fetch(`/api/productos/${productoId}/proveedores`),
      fetch("/api/proveedores"),
    ]);
    if (enlRes.ok) setEnlaces(await enlRes.json());
    if (provRes.ok) setProveedores(await provRes.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargar solo debe correr al montar o si cambia el producto
  }, [productoId]);

  function proveedorNombreDe(enlace: Enlace) {
    return typeof enlace.proveedorId === "string" ? enlace.proveedorId : enlace.proveedorId.nombre;
  }

  function idProveedorDe(enlace: Enlace) {
    return typeof enlace.proveedorId === "string" ? enlace.proveedorId : enlace.proveedorId._id;
  }

  async function agregar() {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/productos/${productoId}/proveedores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedorId,
        costo: Number(costo) || 0,
        ivaPct: Number(ivaPct) || 0,
        iepsPct: Number(iepsPct) || 0,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo agregar el proveedor");
      return;
    }

    setProveedorId("");
    setCosto("");
    setIvaPct("0");
    setIepsPct("0");
    cargar();
  }

  async function actualizarCampo(enlace: Enlace, campo: "costo" | "ivaPct" | "iepsPct", value: string) {
    await fetch(`/api/producto-proveedor/${enlace._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: Number(value) || 0 }),
    });
    cargar();
  }

  async function marcarPrincipal(enlace: Enlace) {
    await fetch(`/api/producto-proveedor/${enlace._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ esPrincipal: !enlace.esPrincipal }),
    });
    cargar();
  }

  async function eliminar(enlace: Enlace) {
    await fetch(`/api/producto-proveedor/${enlace._id}`, { method: "DELETE" });
    cargar();
  }

  const proveedoresDisponibles = proveedores.filter(
    (p) => !enlaces.some((e) => idProveedorDe(e) === p._id)
  );
  const { pagina: paginaEnlaces, paginacion: paginacionEnlaces } = usePaginacion(enlaces);

  return (
    <Modal open onClose={onClose} title={`Proveedores de ${productoNombre}`} icon={Truck} size="lg">
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : enlaces.length === 0 ? (
          <EmptyState message="Este producto no tiene proveedores registrados todavía." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Proveedor</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Costo</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">IVA %</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">IEPS %</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Costo unitario</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium" />
                </tr>
              </thead>
              <tbody>
                {paginaEnlaces.map((e) => (
                  <tr key={e._id} className={`border-b border-black/5 ${!e.activo ? "opacity-50" : ""}`}>
                    <td className="max-w-[16rem] truncate px-2 py-1.5 font-medium" title={proveedorNombreDe(e)}>{proveedorNombreDe(e)}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={e.costo}
                        onBlur={(ev) => actualizarCampo(e, "costo", ev.target.value)}
                        className="w-20 rounded border border-black/10 px-1 py-0.5"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={e.ivaPct}
                        onBlur={(ev) => actualizarCampo(e, "ivaPct", ev.target.value)}
                        className="w-16 rounded border border-black/10 px-1 py-0.5"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={e.iepsPct}
                        onBlur={(ev) => actualizarCampo(e, "iepsPct", ev.target.value)}
                        className="w-16 rounded border border-black/10 px-1 py-0.5"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">${e.costoUnitario.toFixed(2)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => marcarPrincipal(e)}>
                          {e.esPrincipal ? "★ Principal" : "Marcar principal"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => eliminar(e)}>
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacionEnlaces} />
          </>
        )}

        <div className="rounded-lg border border-black/10 p-3">
          <p className="mb-2 text-sm font-medium text-titos-green-900">Agregar proveedor</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="w-48">
              <option value="">Selecciona proveedor...</option>
              {proveedoresDisponibles.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              step="0.01"
              placeholder="Costo"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              className="w-24"
            />
            <Input
              type="number"
              step="0.01"
              placeholder="IVA %"
              value={ivaPct}
              onChange={(e) => setIvaPct(e.target.value)}
              className="w-20"
            />
            <Input
              type="number"
              step="0.01"
              placeholder="IEPS %"
              value={iepsPct}
              onChange={(e) => setIepsPct(e.target.value)}
              className="w-20"
            />
            <Button onClick={agregar} disabled={saving || !proveedorId || !costo}>
              {saving ? "Agregando..." : "Agregar"}
            </Button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
