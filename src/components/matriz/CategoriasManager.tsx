"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, EmptyState, Modal, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Tag } from "lucide-react";

type CategoriaProducto = {
  _id: string;
  nombre: string;
  activo: boolean;
};

function CrearCategoriaModal({ onClose, onCreada }: { onClose: () => void; onCreada: () => void }) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear la categoría");
      return;
    }

    onCreada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva categoría"
      icon={Tag}
      footer={
        <Button onClick={crear} disabled={saving || !nombre}>
          {saving ? "Guardando..." : "Crear categoría"}
        </Button>
      }
    >
      <FormField label="Nombre de la categoría">
        <Input icon={Tag} required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </FormField>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function CategoriaModal({
  categoria,
  onClose,
  onGuardada,
  onEliminada,
}: {
  categoria: CategoriaProducto;
  onClose: () => void;
  onGuardada: () => void;
  onEliminada: () => void;
}) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [activo, setActivo] = useState(categoria.activo);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/categorias/${categoria._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, activo }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudieron guardar los cambios");
      return;
    }

    onGuardada();
  }

  async function eliminar() {
    setError(null);
    setEliminando(true);

    const res = await fetch(`/api/categorias/${categoria._id}`, { method: "DELETE" });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar la categoría");
      return;
    }

    onEliminada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={categoria.nombre}
      icon={Tag}
      footer={
        confirmandoEliminar ? (
          <>
            <span className="self-center text-sm text-black/60">¿Seguro que quieres eliminar esta categoría?</span>
            <Button variant="ghost" onClick={() => setConfirmandoEliminar(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={eliminar} disabled={eliminando}>
              {eliminando ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmandoEliminar(true)}>
              Eliminar
            </Button>
            <Button onClick={guardar} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <FormField label="Nombre">
          <Input icon={Tag} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </FormField>
        <label className="flex items-center gap-2 text-sm text-black/70">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Activa
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function CategoriasManager() {
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriaModal, setCategoriaModal] = useState<CategoriaProducto | null>(null);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setLoading(true);
    const res = await fetch("/api/categorias?todos=1");
    if (res.ok) setCategorias(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  async function alternarActivo(categoria: CategoriaProducto) {
    const res = await fetch(`/api/categorias/${categoria._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !categoria.activo }),
    });
    if (res.ok) cargar();
  }

  const { pagina, paginacion } = usePaginacion(categorias);

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Categorías ({categorias.length})</h2>
          <Button onClick={() => setCreando(true)}>+ Nueva categoría</Button>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : categorias.length === 0 ? (
          <EmptyState message="Todavía no hay categorías registradas." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Nombre</th>
                  <th className="px-2 py-1.5 text-xs font-medium" />
                </tr>
              </thead>
              <tbody>
                {pagina.map((c) => (
                  <tr key={c._id} className={`border-b border-black/5 ${!c.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {c.nombre}
                      {!c.activo ? <span className="ml-1 text-xs text-black/40">(inactiva)</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setCategoriaModal(c)}>
                          Ver / Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => alternarActivo(c)}>
                          {c.activo ? "Desactivar" : "Activar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacion} />
          </>
        )}
      </Card>

      {creando ? (
        <CrearCategoriaModal
          onClose={() => setCreando(false)}
          onCreada={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {categoriaModal ? (
        <CategoriaModal
          categoria={categoriaModal}
          onClose={() => setCategoriaModal(null)}
          onGuardada={() => {
            setCategoriaModal(null);
            cargar();
          }}
          onEliminada={() => {
            setCategoriaModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
