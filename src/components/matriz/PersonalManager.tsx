"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, EmptyState, Modal, FormGrid, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Users, User, Briefcase, MessageCircle } from "lucide-react";
import { PUESTOS_BASE } from "@/lib/puestos";

type Empleado = {
  _id: string;
  nombre: string;
  puesto: string;
  whatsapp: string;
  activo: boolean;
};

const NUEVO_PUESTO = "__nuevo__";
const emptyForm = { nombre: "", puesto: "", whatsapp: "" };

function PuestoField({
  puestosDisponibles,
  value,
  onChange,
}: {
  puestosDisponibles: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const esConocido = value === "" || puestosDisponibles.includes(value);
  const [modoNuevo, setModoNuevo] = useState(!esConocido);

  return (
    <div>
      {modoNuevo ? (
        <div className="flex gap-2">
          <Input
            icon={Briefcase}
            placeholder="Nombre del nuevo puesto"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setModoNuevo(false);
              onChange("");
            }}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Select
          icon={Briefcase}
          value={value}
          onChange={(e) => {
            if (e.target.value === NUEVO_PUESTO) {
              setModoNuevo(true);
              onChange("");
            } else {
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Selecciona un puesto</option>
          {puestosDisponibles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={NUEVO_PUESTO}>+ Nuevo puesto...</option>
        </Select>
      )}
    </div>
  );
}

function CrearEmpleadoModal({
  puestosDisponibles,
  onClose,
  onCreado,
}: {
  puestosDisponibles: string[];
  onClose: () => void;
  onCreado: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/empleados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear el empleado");
      return;
    }

    onCreado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo empleado"
      icon={Users}
      size="lg"
      footer={
        <Button onClick={crear} disabled={saving || !form.nombre || !form.whatsapp}>
          {saving ? "Guardando..." : "Agregar empleado"}
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Nombre">
          <Input icon={User} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </FormField>
        <FormField label="Puesto">
          <PuestoField puestosDisponibles={puestosDisponibles} value={form.puesto} onChange={(puesto) => setForm({ ...form, puesto })} />
        </FormField>
        <FormField label="WhatsApp" className="sm:col-span-2">
          <Input icon={MessageCircle} required value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
        </FormField>
      </FormGrid>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function EmpleadoModal({
  empleado,
  puestosDisponibles,
  onClose,
  onGuardado,
  onEliminado,
}: {
  empleado: Empleado;
  puestosDisponibles: string[];
  onClose: () => void;
  onGuardado: () => void;
  onEliminado: () => void;
}) {
  const [nombre, setNombre] = useState(empleado.nombre);
  const [puesto, setPuesto] = useState(empleado.puesto);
  const [whatsapp, setWhatsapp] = useState(empleado.whatsapp);
  const [activo, setActivo] = useState(empleado.activo);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/empleados/${empleado._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, puesto, whatsapp, activo }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudieron guardar los cambios");
      return;
    }

    onGuardado();
  }

  async function eliminar() {
    setError(null);
    setEliminando(true);

    const res = await fetch(`/api/empleados/${empleado._id}`, { method: "DELETE" });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar el empleado");
      return;
    }

    onEliminado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={empleado.nombre}
      icon={Users}
      size="lg"
      footer={
        confirmandoEliminar ? (
          <>
            <span className="self-center text-sm text-black/60">¿Seguro que quieres eliminar este empleado?</span>
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
        <FormGrid>
          <FormField label="Nombre">
            <Input icon={User} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </FormField>
          <FormField label="Puesto">
            <PuestoField puestosDisponibles={puestosDisponibles} value={puesto} onChange={setPuesto} />
          </FormField>
          <FormField label="WhatsApp" className="sm:col-span-2">
            <Input icon={MessageCircle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </FormField>
        </FormGrid>
        <label className="flex items-center gap-2 text-sm text-black/70">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Activo
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function PersonalManager() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [empleadoModal, setEmpleadoModal] = useState<Empleado | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setLoading(true);
    const res = await fetch("/api/empleados?todos=1");
    if (res.ok) setEmpleados(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  const puestosDisponibles = useMemo(() => {
    const conocidos = new Set<string>(PUESTOS_BASE);
    for (const e of empleados) {
      if (e.puesto) conocidos.add(e.puesto);
    }
    return Array.from(conocidos).sort((a, b) => a.localeCompare(b, "es"));
  }, [empleados]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return empleados;
    return empleados.filter(
      (e) => e.nombre.toLowerCase().includes(texto) || e.puesto.toLowerCase().includes(texto)
    );
  }, [empleados, busqueda]);
  const { pagina, paginacion } = usePaginacion(visibles, busqueda);

  async function alternarActivo(empleado: Empleado) {
    const res = await fetch(`/api/empleados/${empleado._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !empleado.activo }),
    });
    if (res.ok) cargar();
  }

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-titos-green-900">Personal ({empleados.length})</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-64">
              <Input
                placeholder="Buscar por nombre o puesto..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <Button className="shrink-0" onClick={() => setCreando(true)}>
              + Nuevo empleado
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : visibles.length === 0 ? (
          <EmptyState message="No hay personal que coincida con la búsqueda." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Nombre</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Puesto</th>
                  <th className="px-2 py-1.5 text-xs font-medium">WhatsApp</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {pagina.map((e) => (
                  <tr key={e._id} className={`border-b border-black/5 ${!e.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {e.nombre}
                      {!e.activo ? <span className="ml-1 text-xs text-black/40">(inactivo)</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{e.puesto || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{e.whatsapp}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEmpleadoModal(e)}>
                          Ver / Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => alternarActivo(e)}>
                          {e.activo ? "Desactivar" : "Activar"}
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
        <CrearEmpleadoModal
          puestosDisponibles={puestosDisponibles}
          onClose={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {empleadoModal ? (
        <EmpleadoModal
          empleado={empleadoModal}
          puestosDisponibles={puestosDisponibles}
          onClose={() => setEmpleadoModal(null)}
          onGuardado={() => {
            setEmpleadoModal(null);
            cargar();
          }}
          onEliminado={() => {
            setEmpleadoModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
