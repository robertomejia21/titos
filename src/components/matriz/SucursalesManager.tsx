"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, Select, EmptyState, Modal, FormGrid, FormField, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { Store, MapPin, MessageCircle, User, Mail, Lock, TriangleAlert, Clock } from "lucide-react";
import { ZONAS_HORARIAS, ZONA_HORARIA_DEFAULT, zonaHorariaLabel } from "@/lib/zonasHorarias";

type Sucursal = {
  _id: string;
  nombre: string;
  direccion: string;
  whatsapp: string;
  zonaHoraria?: string;
  activo: boolean;
  // El mostrador de matriz aparece aquí porque también cobra y hace corte, pero
  // no es una sucursal que se administre ni se pueda eliminar.
  esMatriz?: boolean;
  usuario: { usuario?: string | null; email: string; nombre: string } | null;
};

const emptyForm = {
  nombre: "",
  direccion: "",
  whatsapp: "",
  zonaHoraria: ZONA_HORARIA_DEFAULT,
  usuarioNombre: "",
  usuario: "",
  email: "",
  password: "",
};

function ZonaHorariaField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <FormField label="Zona horaria" className="sm:col-span-2">
      <Select icon={Clock} value={value} onChange={(e) => onChange(e.target.value)}>
        {ZONAS_HORARIAS.map((z) => (
          <option key={z.value} value={z.value}>
            {z.label}
          </option>
        ))}
      </Select>
      <p className="mt-1 text-xs text-black/40">
        Define las horas locales de la sucursal (corte de pedidos, cortes de caja y reportes por día).
      </p>
    </FormField>
  );
}

function CrearSucursalModal({ onClose, onCreada }: { onClose: () => void; onCreada: () => void }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin usuario no hay login. Correo y contraseña sueltos (casi siempre el
  // navegador rellenándolos) no deben apagar "Crear sucursal".
  const quiereUsuario = !!form.usuario.trim();
  const credencialIncompleta = quiereUsuario && form.password.length < 6;

  async function crear() {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/sucursales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        quiereUsuario ? form : { ...form, usuario: "", email: "", password: "" }
      ),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo crear la sucursal");
      return;
    }

    onCreada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva sucursal"
      icon={Store}
      size="lg"
      footer={
        <Button onClick={crear} disabled={saving || !form.nombre || credencialIncompleta}>
          {saving ? "Guardando..." : "Crear sucursal"}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="Nombre de la sucursal" className="sm:col-span-2">
            <Input icon={Store} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </FormField>
          <FormField label="Dirección" className="sm:col-span-2">
            <Input icon={MapPin} value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          </FormField>
          <FormField label="WhatsApp (opcional)" className="sm:col-span-2">
            <Input icon={MessageCircle} value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          </FormField>
          <ZonaHorariaField value={form.zonaHoraria} onChange={(zonaHoraria) => setForm({ ...form, zonaHoraria })} />
        </FormGrid>

        <div className="rounded-xl border border-black/10 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">
            Usuario de acceso de la sucursal <span className="normal-case text-black/30">(opcional)</span>
          </p>
          <p className="mb-3 text-xs text-black/40">
            Puedes dejarlo vacío y dar de alta la tienda ahora; el usuario se crea después desde Usuarios y roles.
          </p>
          <FormGrid>
            <FormField label="Nombre del responsable (opcional)" className="sm:col-span-2">
              <Input icon={User} value={form.usuarioNombre} onChange={(e) => setForm({ ...form, usuarioNombre: e.target.value })} />
              <p className="mt-1 text-xs text-black/40">Si lo dejas vacío, queda a tu nombre.</p>
            </FormField>
            <FormField label="Usuario de acceso">
              <Input icon={User} name="sucursal-usuario" value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} placeholder="ej. centro" autoComplete="off" />
            </FormField>
            <FormField label="Correo (opcional)">
              <Input icon={Mail} name="sucursal-correo" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>
            <FormField label="Contraseña">
              <Input
                icon={Lock}
                type="password"
                name="sucursal-clave-nueva"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
              />
            </FormField>
          </FormGrid>
          {credencialIncompleta ? (
            <p className="mt-2 text-xs font-medium text-amber-700">
              La contraseña del usuario de acceso necesita al menos 6 caracteres.
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

function SucursalModal({
  sucursal,
  onClose,
  onGuardado,
}: {
  sucursal: Sucursal;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(sucursal.nombre);
  const [direccion, setDireccion] = useState(sucursal.direccion);
  const [whatsapp, setWhatsapp] = useState(sucursal.whatsapp);
  const [zonaHoraria, setZonaHoraria] = useState(sucursal.zonaHoraria || ZONA_HORARIA_DEFAULT);
  const [activo, setActivo] = useState(sucursal.activo);
  const [nombreUsuario, setNombreUsuario] = useState(sucursal.usuario?.usuario ?? "");
  const [email, setEmail] = useState(sucursal.usuario?.email ?? "");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const resSucursal = await fetch(`/api/sucursales/${sucursal._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, direccion, whatsapp, zonaHoraria, activo }),
    });

    if (!resSucursal.ok) {
      const data = await resSucursal.json().catch(() => ({}));
      setSaving(false);
      setError(data.error || "No se pudieron guardar los datos de la sucursal");
      return;
    }

    if (sucursal.usuario && (nombreUsuario !== (sucursal.usuario.usuario ?? "") || email !== sucursal.usuario.email || nuevaPassword)) {
      const resUsuario = await fetch(`/api/sucursales/${sucursal._id}/usuario`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: nombreUsuario || undefined, email, password: nuevaPassword || undefined }),
      });

      setSaving(false);

      if (!resUsuario.ok) {
        const data = await resUsuario.json().catch(() => ({}));
        setError(data.error || "No se pudo actualizar el usuario de acceso");
        return;
      }
    } else {
      setSaving(false);
    }

    onGuardado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={sucursal.nombre}
      icon={Store}
      size="lg"
      footer={
        <Button onClick={guardar} disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="Nombre" className="sm:col-span-2">
            <Input icon={Store} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </FormField>
          <FormField label="Dirección" className="sm:col-span-2">
            <Input icon={MapPin} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </FormField>
          <FormField label="WhatsApp" className="sm:col-span-2">
            <Input icon={MessageCircle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </FormField>
          <ZonaHorariaField value={zonaHoraria} onChange={setZonaHoraria} />
        </FormGrid>

        {/* Inactivar es la salida para una tienda que ya operó: eliminarla no se
            puede una vez que tiene ventas o cortes. */}
        <label className="flex items-start gap-2 rounded-xl border border-black/10 p-3 text-sm text-black/70">
          <input type="checkbox" className="mt-0.5" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span>
            Sucursal activa
            <span className="block text-xs text-black/40">
              Desmárcala para inactivarla: deja de aparecer para operar, pero conserva su historial de ventas y
              cortes.
            </span>
          </span>
        </label>

        <div className="rounded-xl border border-black/10 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-black/40">Usuario de acceso</p>
          {sucursal.usuario ? (
            <FormGrid>
              <FormField label="Usuario">
                <Input icon={User} value={nombreUsuario} onChange={(e) => setNombreUsuario(e.target.value)} autoComplete="off" />
              </FormField>
              <FormField label="Correo (opcional)">
                <Input icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
              <FormField label="Nueva contraseña">
                <Input
                  icon={Lock}
                  type="password"
                  placeholder="Dejar en blanco para no cambiarla"
                  value={nuevaPassword}
                  onChange={(e) => setNuevaPassword(e.target.value)}
                />
              </FormField>
            </FormGrid>
          ) : (
            <p className="text-sm text-black/40">Esta sucursal no tiene un usuario de acceso ligado.</p>
          )}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

function EliminarSucursalModal({
  sucursal,
  onClose,
  onEliminada,
}: {
  sucursal: Sucursal;
  onClose: () => void;
  onEliminada: () => void;
}) {
  const [password, setPassword] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eliminar() {
    setError(null);
    setEliminando(true);

    const res = await fetch(`/api/sucursales/${sucursal._id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar la sucursal");
      return;
    }

    onEliminada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Eliminar ${sucursal.nombre}`}
      icon={TriangleAlert}
      footer={
        <Button variant="danger" onClick={eliminar} disabled={eliminando || !password}>
          {eliminando ? "Eliminando..." : "Eliminar sucursal"}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          Esta acción no se puede deshacer. Se eliminará la sucursal, su usuario de acceso y sus registros de
          inventario. Si la sucursal ya tiene pedidos, ventas o cortes de caja registrados, no se podrá eliminar —
          desactívala en su lugar.
        </p>
        <FormField label="Confirma tu contraseña para continuar">
          <Input
            icon={Lock}
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) eliminar();
            }}
          />
        </FormField>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function SucursalesManager() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sucursalModal, setSucursalModal] = useState<Sucursal | null>(null);
  const [creando, setCreando] = useState(false);
  const [sucursalAEliminar, setSucursalAEliminar] = useState<Sucursal | null>(null);

  async function cargar() {
    setLoading(true);
    const res = await fetch("/api/sucursales");
    if (res.ok) setSucursales(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  const { pagina, paginacion } = usePaginacion(sucursales);

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Sucursales ({sucursales.length})</h2>
          <Button onClick={() => setCreando(true)}>+ Nueva sucursal</Button>
        </div>
        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : sucursales.length === 0 ? (
          <EmptyState message="Todavía no hay sucursales registradas." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Nombre</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Dirección</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Zona horaria</th>
                  <th className="px-2 py-1.5 text-xs font-medium">WhatsApp</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Usuario</th>
                  <th className="w-px px-2 py-1.5 text-xs font-medium" />
                </tr>
              </thead>
              <tbody>
                {pagina.map((s) => (
                  <tr key={s._id} className={`border-b border-black/5 ${!s.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {s.nombre}
                      {s.esMatriz ? (
                        <span className="ml-1.5 rounded-full bg-titos-green-100 px-2 py-0.5 text-xs font-semibold text-titos-green-700">
                          Mostrador
                        </span>
                      ) : null}
                      {!s.activo ? <span className="ml-1 text-xs text-black/40">(inactiva)</span> : null}
                    </td>
                    <td className="max-w-[16rem] truncate px-2 py-1.5 text-black/60" title={s.direccion || undefined}>
                      {s.direccion || "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{zonaHorariaLabel(s.zonaHoraria)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{s.whatsapp || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{s.usuario?.usuario || s.usuario?.email || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" className="w-24" onClick={() => setSucursalModal(s)}>
                          Ver / Editar
                        </Button>
                        {s.esMatriz ? null : (
                          <Button size="sm" variant="danger" className="w-20" onClick={() => setSucursalAEliminar(s)}>
                            Eliminar
                          </Button>
                        )}
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
        <CrearSucursalModal
          onClose={() => setCreando(false)}
          onCreada={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {sucursalModal ? (
        <SucursalModal
          sucursal={sucursalModal}
          onClose={() => setSucursalModal(null)}
          onGuardado={() => {
            setSucursalModal(null);
            cargar();
          }}
        />
      ) : null}

      {sucursalAEliminar ? (
        <EliminarSucursalModal
          sucursal={sucursalAEliminar}
          onClose={() => setSucursalAEliminar(null)}
          onEliminada={() => {
            setSucursalAEliminar(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
