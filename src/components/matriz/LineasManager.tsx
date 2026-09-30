"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, EmptyState, Modal, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Tags } from "lucide-react";

type LineaProducto = {
  _id: string;
  nombre: string;
  activo: boolean;
};

function CrearLineaModal({ onClose, onCreada }: { onClose: () => void; onCreada: () => void }) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/lineas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear la línea");
      return;
    }

    onCreada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva línea"
      icon={Tags}
      footer={
        <Button onClick={crear} disabled={saving || !nombre}>
          {saving ? "Guardando..." : "Crear línea"}
        </Button>
      }
    >
      <FormField label="Nombre de la línea">
        <Input icon={Tags} required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </FormField>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function LineaModal({
  linea,
  onClose,
  onGuardada,
  onEliminada,
}: {
  linea: LineaProducto;
  onClose: () => void;
  onGuardada: () => void;
  onEliminada: () => void;
}) {
  const [nombre, setNombre] = useState(linea.nombre);
  const [activo, setActivo] = useState(linea.activo);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/lineas/${linea._id}`, {
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

    const res = await fetch(`/api/lineas/${linea._id}`, { method: "DELETE" });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar la línea");
      return;
    }

    onEliminada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={linea.nombre}
      icon={Tags}
      footer={
        confirmandoEliminar ? (
          <>
            <span className="self-center text-sm text-black/60">¿Seguro que quieres eliminar esta línea?</span>
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
          <Input icon={Tags} value={nombre} onChange={(e) => setNombre(e.target.value)} />
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

export function LineasManager() {
  const [lineas, setLineas] = useState<LineaProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [lineaModal, setLineaModal] = useState<LineaProducto | null>(null);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setLoading(true);
    const res = await fetch("/api/lineas?todos=1");
    if (res.ok) setLineas(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  async function alternarActivo(linea: LineaProducto) {
    const res = await fetch(`/api/lineas/${linea._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !linea.activo }),
    });
    if (res.ok) cargar();
  }

  const { pagina, paginacion } = usePaginacion(lineas);

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Líneas ({lineas.length})</h2>
          <Button onClick={() => setCreando(true)}>+ Nueva línea</Button>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : lineas.length === 0 ? (
          <EmptyState message="Todavía no hay líneas registradas." />
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
                {pagina.map((l) => (
                  <tr key={l._id} className={`border-b border-black/5 ${!l.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {l.nombre}
                      {!l.activo ? <span className="ml-1 text-xs text-black/40">(inactiva)</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setLineaModal(l)}>
                          Ver / Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => alternarActivo(l)}>
                          {l.activo ? "Desactivar" : "Activar"}
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
        <CrearLineaModal
          onClose={() => setCreando(false)}
          onCreada={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {lineaModal ? (
        <LineaModal
          linea={lineaModal}
          onClose={() => setLineaModal(null)}
          onGuardada={() => {
            setLineaModal(null);
            cargar();
          }}
          onEliminada={() => {
            setLineaModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
