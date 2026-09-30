"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Input, EmptyState, Modal, FormGrid, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Truck, User, MessageCircle, Mail, Pencil, Power, PowerOff, PauseCircle, PlayCircle, type LucideIcon } from "lucide-react";

type Proveedor = {
  _id: string;
  nombre: string;
  contacto: string;
  whatsapp: string;
  email: string;
  activo: boolean;
};

const emptyForm = { nombre: "", contacto: "", whatsapp: "", email: "" };

type ActionButtonTone = "edit" | "activate" | "deactivate" | "suspend" | "resume";

const actionButtonToneClasses: Record<ActionButtonTone, string> = {
  edit: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
  activate: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  deactivate: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  suspend: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  resume: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
};

function ActionButton({
  children,
  icon: Icon,
  tone,
  className = "",
  ...props
}: {
  children: ReactNode;
  icon: LucideIcon;
  tone: ActionButtonTone;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-7 min-w-max shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${actionButtonToneClasses[tone]} ${className}`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

function CrearProveedorModal({ onClose, onCreado }: { onClose: () => void; onCreado: () => void }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear el proveedor");
      return;
    }

    onCreado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo proveedor"
      icon={Truck}
      size="lg"
      footer={
        <Button onClick={crear} disabled={saving || !form.nombre}>
          {saving ? "Guardando..." : "Crear proveedor"}
        </Button>
      }
    >
      <FormGrid>
        <FormField label="Nombre del proveedor" className="sm:col-span-2">
          <Input icon={Truck} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </FormField>
        <FormField label="Persona de contacto">
          <Input icon={User} value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
        </FormField>
        <FormField label="WhatsApp">
          <Input icon={MessageCircle} value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
        </FormField>
        <FormField label="Correo" className="sm:col-span-2">
          <Input icon={Mail} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </FormField>
      </FormGrid>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </Modal>
  );
}

function ProveedorModal({
  proveedor,
  onClose,
  onGuardado,
  onEliminado,
}: {
  proveedor: Proveedor;
  onClose: () => void;
  onGuardado: () => void;
  onEliminado: () => void;
}) {
  const [nombre, setNombre] = useState(proveedor.nombre);
  const [contacto, setContacto] = useState(proveedor.contacto);
  const [whatsapp, setWhatsapp] = useState(proveedor.whatsapp);
  const [email, setEmail] = useState(proveedor.email);
  const [activo, setActivo] = useState(proveedor.activo);
  const [saving, setSaving] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/proveedores/${proveedor._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, contacto, whatsapp, email, activo }),
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

    const res = await fetch(`/api/proveedores/${proveedor._id}`, { method: "DELETE" });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar el proveedor");
      return;
    }

    onEliminado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={proveedor.nombre}
      icon={Truck}
      size="lg"
      footer={
        confirmandoEliminar ? (
          <>
            <span className="self-center text-sm text-black/60">¿Seguro que quieres eliminar este proveedor?</span>
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
          <FormField label="Nombre" className="sm:col-span-2">
            <Input icon={Truck} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </FormField>
          <FormField label="Persona de contacto">
            <Input icon={User} value={contacto} onChange={(e) => setContacto(e.target.value)} />
          </FormField>
          <FormField label="WhatsApp">
            <Input icon={MessageCircle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </FormField>
          <FormField label="Correo" className="sm:col-span-2">
            <Input icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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

export function ProveedoresManager() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [proveedorModal, setProveedorModal] = useState<Proveedor | null>(null);
  const [creando, setCreando] = useState(false);
  const { pagina: paginaProveedores, paginacion: paginacionProveedores } = usePaginacion(proveedores);

  async function cargar() {
    setLoading(true);
    const res = await fetch("/api/proveedores?todos=1");
    if (res.ok) setProveedores(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  async function alternarActivo(proveedor: Proveedor) {
    const res = await fetch(`/api/proveedores/${proveedor._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !proveedor.activo }),
    });
    if (res.ok) cargar();
  }

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Proveedores ({proveedores.length})</h2>
          <Button onClick={() => setCreando(true)}>+ Nuevo proveedor</Button>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : proveedores.length === 0 ? (
          <EmptyState message="Todavía no hay proveedores registrados." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Nombre</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Contacto</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">WhatsApp</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">Correo</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-xs font-medium" />
                </tr>
              </thead>
              <tbody>
                {paginaProveedores.map((p) => (
                  <tr key={p._id} className={`border-b border-black/5 ${!p.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {p.nombre}
                      {!p.activo ? <span className="ml-1 text-xs text-black/40">(inactivo)</span> : null}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1.5 text-black/60" title={p.contacto || undefined}>{p.contacto || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{p.whatsapp || "—"}</td>
                    <td className="max-w-[16rem] truncate px-2 py-1.5 text-black/60" title={p.email || undefined}>{p.email || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <ActionButton icon={Pencil} tone="edit" onClick={() => setProveedorModal(p)}>
                          Ver / Editar
                        </ActionButton>
                        <ActionButton
                          icon={p.activo ? PowerOff : Power}
                          tone={p.activo ? "deactivate" : "activate"}
                          onClick={() => alternarActivo(p)}
                        >
                          {p.activo ? "Desactivar" : "Activar"}
                        </ActionButton>
                        <ActionButton
                          icon={p.activo ? PauseCircle : PlayCircle}
                          tone={p.activo ? "suspend" : "resume"}
                          onClick={() => alternarActivo(p)}
                        >
                          {p.activo ? "Suspender" : "Reanudar"}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacionProveedores} />
          </>
        )}
      </Card>

      {creando ? (
        <CrearProveedorModal
          onClose={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {proveedorModal ? (
        <ProveedorModal
          proveedor={proveedorModal}
          onClose={() => setProveedorModal(null)}
          onGuardado={() => {
            setProveedorModal(null);
            cargar();
          }}
          onEliminado={() => {
            setProveedorModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
