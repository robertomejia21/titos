"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Mail, KeyRound, UserCircle } from "lucide-react";
import { Button, Card, Input, Select, Modal, FormField, FormGrid, EmptyState } from "@/components/ui";

type SucursalRol = "admin" | "ventas";

type Usuario = {
  _id: string;
  nombre: string;
  usuario?: string | null;
  email: string;
  sucursalRol: SucursalRol;
  activo: boolean;
  propio: boolean;
};

const ROL_LABEL: Record<SucursalRol, string> = {
  admin: "Administrador",
  ventas: "Ventas",
};

const ROL_DESCRIPCION: Record<SucursalRol, string> = {
  admin: "Acceso completo a todos los módulos de la sucursal.",
  ventas: "Solo puede usar el punto de venta, con la pantalla ampliada para cobrar.",
};

function UsuarioFormModal({
  usuario,
  onClose,
  onGuardado,
}: {
  usuario: Usuario | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esEdicion = usuario !== null;
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [nombreUsuario, setNombreUsuario] = useState(usuario?.usuario ?? "");
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<SucursalRol>(usuario?.sucursalRol ?? "ventas");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setSaving(true);

    const payload: Record<string, unknown> = { nombre: nombre.trim(), usuario: nombreUsuario.trim(), email: email.trim() };
    if (!esEdicion || password) payload.password = password;
    if (!esEdicion || !usuario.propio) payload.sucursalRol = rol;

    const res = await fetch(esEdicion ? `/api/sucursal-usuarios/${usuario._id}` : "/api/sucursal-usuarios", {
      method: esEdicion ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el usuario");
      return;
    }

    onGuardado();
  }

  const puedeGuardar = nombre.trim() && nombreUsuario.trim() && (esEdicion || password.length >= 6);

  return (
    <Modal
      open
      onClose={onClose}
      title={esEdicion ? `Editar usuario — ${usuario.nombre}` : "Nuevo usuario"}
      icon={UserPlus}
      size="lg"
      footer={
        <Button onClick={guardar} disabled={saving || !puedeGuardar}>
          {saving ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear usuario"}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="Nombre">
            <Input icon={UserCircle} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del empleado" />
          </FormField>
          <FormField label="Usuario de acceso">
            <Input icon={UserCircle} value={nombreUsuario} onChange={(e) => setNombreUsuario(e.target.value)} placeholder="ej. jperez" autoComplete="off" />
          </FormField>
          <FormField label="Correo (opcional)">
            <Input icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Solo como dato de contacto" />
          </FormField>
          <FormField label={esEdicion ? "Nueva contraseña (opcional)" : "Contraseña"}>
            <Input
              icon={KeyRound}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={esEdicion ? "Dejar en blanco para no cambiarla" : "Mínimo 6 caracteres"}
            />
          </FormField>
          {!esEdicion || !usuario.propio ? (
            <FormField label="Rol">
              <Select value={rol} onChange={(e) => setRol(e.target.value as SucursalRol)}>
                <option value="admin">{ROL_LABEL.admin}</option>
                <option value="ventas">{ROL_LABEL.ventas}</option>
              </Select>
            </FormField>
          ) : null}
        </FormGrid>
        {!esEdicion || !usuario.propio ? (
          <p className="rounded-lg bg-titos-green-100 px-3 py-2 text-xs text-titos-green-900">{ROL_DESCRIPCION[rol]}</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function UsuariosManager() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ abierto: boolean; usuario: Usuario | null }>({ abierto: false, usuario: null });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/sucursal-usuarios");
    if (res.ok) setUsuarios(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, [cargar]);

  async function alternarActivo(u: Usuario) {
    setError(null);
    const res = await fetch(`/api/sucursal-usuarios/${u._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !u.activo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo actualizar el usuario");
      return;
    }
    cargar();
  }

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Usuarios de la sucursal ({usuarios.length})</h2>
          <Button onClick={() => setModal({ abierto: true, usuario: null })}>
            <span className="flex items-center gap-1.5">
              <UserPlus className="h-4 w-4" /> Nuevo usuario
            </span>
          </Button>
        </div>

        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="py-8 text-center text-sm text-black/50">Cargando usuarios...</p>
        ) : usuarios.length === 0 ? (
          <EmptyState message="Todavía no hay usuarios registrados en esta sucursal." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="py-2 pr-2">Nombre</th>
                  <th className="py-2 pr-2">Usuario</th>
                  <th className="py-2 pr-2">Rol</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2 pr-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u._id} className="border-b border-black/5">
                    <td className="py-2 pr-2 font-medium">
                      {u.nombre}
                      {u.propio ? <span className="ml-1.5 text-xs font-normal text-black/40">(tú)</span> : null}
                    </td>
                    <td className="py-2 pr-2 text-black/60">
                      {u.usuario ?? <span className="text-black/30">— sin usuario —</span>}
                      {u.email ? <span className="block text-xs text-black/35">{u.email}</span> : null}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          u.sucursalRol === "admin" ? "bg-titos-green-100 text-titos-green-700" : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {ROL_LABEL[u.sucursalRol]}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          u.activo ? "bg-titos-green-100 text-titos-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setModal({ abierto: true, usuario: u })}
                          className="text-xs font-medium text-titos-green-700 hover:underline"
                        >
                          Editar
                        </button>
                        {!u.propio ? (
                          <button
                            onClick={() => alternarActivo(u)}
                            className={`text-xs font-medium hover:underline ${u.activo ? "text-red-600" : "text-titos-green-700"}`}
                          >
                            {u.activo ? "Desactivar" : "Activar"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal.abierto ? (
        <UsuarioFormModal
          usuario={modal.usuario}
          onClose={() => setModal({ abierto: false, usuario: null })}
          onGuardado={() => {
            setModal({ abierto: false, usuario: null });
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
