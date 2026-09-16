"use client";

import { useState } from "react";
import { Button, Card, FormField, Input, Modal, EmptyState } from "@/components/ui";

export type Departamento = { _id: string; nombre: string; descripcion: string; activo: boolean };

export function DepartamentosManager({ departamentos, puestos, onGuardado }: {
  departamentos: Departamento[]; puestos: { departamentoId?: string | null }[]; onGuardado: () => void;
}) {
  const [editando, setEditando] = useState<Departamento | null | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [activo, setActivo] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  function abrir(d: Departamento | null) {
    setEditando(d); setNombre(d?.nombre ?? ""); setDescripcion(d?.descripcion ?? ""); setActivo(d?.activo ?? true); setError("");
  }
  async function guardar() {
    setGuardando(true); setError("");
    try {
      const res = await fetch(editando ? `/api/departamentos/${editando._id}` : "/api/departamentos", {
        method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, descripcion, activo }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
      setEditando(undefined); onGuardado();
    } catch { setError("No se pudo conectar. Intenta de nuevo."); } finally { setGuardando(false); }
  }
  const visibles = departamentos.filter((d) => d.nombre.toLocaleLowerCase("es").includes(busqueda.trim().toLocaleLowerCase("es")));
  return <Card>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-titos-green-900">Departamentos</h2><Button onClick={() => abrir(null)}>+ Nuevo departamento</Button></div>
    <p className="mb-4 text-sm text-black/75">Crea los departamentos y después asígnalos a cada puesto en la pestaña Puestos. El departamento organiza al personal; los permisos se definen por puesto o por usuario.</p>
    <Input aria-label="Buscar departamento" type="search" placeholder="Buscar departamento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="mb-3 border-black/50" />
    {!visibles.length ? <EmptyState message="No hay departamentos que mostrar. Puedes crear el primero." /> : <ul className="divide-y divide-black/10">{visibles.map((d) => <li key={d._id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-medium">{d.nombre} · {d.activo ? "Activo" : "Inactivo"}</p><p className="text-sm text-black/75">{d.descripcion}</p><p className="text-xs text-black/75">{puestos.filter((p) => p.departamentoId === d._id).length} puestos asignados</p></div><Button variant="ghost" onClick={() => abrir(d)}>Editar {d.nombre}</Button></li>)}</ul>}
    {editando !== undefined ? <Modal open title={editando ? "Editar departamento" : "Nuevo departamento"} onClose={() => setEditando(undefined)} footer={<Button disabled={guardando || !nombre.trim()} onClick={guardar}>{guardando ? "Guardando…" : "Guardar departamento"}</Button>}>
      <div className="space-y-4">
        <FormField label="Nombre del departamento"><Input aria-label="Nombre del departamento" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></FormField>
        <FormField label="Descripción (opcional)"><Input aria-label="Descripción del departamento" value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} /></FormField>
        {editando ? <label className="flex items-center gap-2"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />Departamento activo</label> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </div>
    </Modal> : null}
  </Card>;
}
