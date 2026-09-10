"use client";

import { useEffect, useMemo, useState } from "react";
import { UserCog, ShieldCheck, Store, Mail, KeyRound, ShieldAlert } from "lucide-react";
import { Button, Card, Input, Select, EmptyState, Modal, FormField, FormGrid } from "@/components/ui";
import { PERMISOS, permisosDeAmbito, type AmbitoRolPermiso } from "@/lib/permisos";
import { PUESTOS } from "@/lib/puestos";
import { requiereNipCaja } from "@/lib/nipCaja";

type Rol = {
  _id: string;
  nombre: string;
  descripcion: string;
  ambito: AmbitoRolPermiso;
  permisos: string[];
  perfilDocumentoId?: string | null;
  /** Rol de mando: asignarlo exige el NIP de 6 dígitos de matriz. */
  esSupervisor: boolean;
  esSistema: boolean;
  activo: boolean;
};

type Usuario = {
  _id: string;
  nombre: string;
  email: string;
  role: "matriz" | "sucursal";
  sucursalRol: "admin" | "ventas";
  sucursal: { _id: string; nombre: string } | null;
  rol: { _id: string; nombre: string; ambito: string } | null;
  /** Ya tiene NIP personal para autorizar cancelaciones y retiros. */
  tieneNipOperacion?: boolean;
  activo: boolean;
  propio: boolean;
};

type Sucursal = { _id: string; nombre: string; esMatriz: boolean };

const ETIQUETA_AMBITO: Record<AmbitoRolPermiso, string> = {
  matriz: "Matriz",
  sucursal: "Sucursal",
};

/** Perfil heredado que se aplica mientras el usuario no tenga un rol asignado. */
function rolMostrado(u: Usuario) {
  if (u.rol) return u.rol.nombre;
  if (u.role === "matriz") return "Administrador de matriz (heredado)";
  return u.sucursalRol === "ventas" ? "Cajero (heredado)" : "Administrador de sucursal (heredado)";
}

// ---------------------------------------------------------------- Usuarios ---

function UsuarioModal({
  usuario,
  roles,
  sucursales,
  onClose,
  onGuardado,
}: {
  usuario: Usuario | null;
  roles: Rol[];
  sucursales: Sucursal[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esEdicion = !!usuario;
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"matriz" | "sucursal">(usuario?.role ?? "sucursal");
  const [sucursalId, setSucursalId] = useState(usuario?.sucursal?._id ?? "");
  const [rolId, setRolId] = useState(usuario?.rol?._id ?? "");
  const [nipSupervisor, setNipSupervisor] = useState("");
  const [nipOperacion, setNipOperacion] = useState("");
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Solo se ofrecen los roles del ámbito correcto: un rol de sucursal no tiene
  // sentido en un usuario de matriz.
  const rolesDisponibles = roles.filter((r) => r.activo && (!esEdicion || r.ambito === role));

  // El NIP solo se pide cuando el rol elegido es de supervisor, y al editar solo
  // si además el rol está cambiando: guardar el teléfono de un supervisor que ya
  // lo era no tiene por qué pedirlo (es la misma regla que aplica el servidor).
  const rolElegido = roles.find((r) => r._id === rolId) ?? null;
  const esEncargado = !!rolElegido?.esSupervisor;
  const pideNipSupervisor = esEncargado && (!esEdicion || usuario!.rol?._id !== rolId);
  const yaTieneNip = esEdicion && !!usuario!.tieneNipOperacion;
  const usaNipCaja = requiereNipCaja(rolElegido, esEdicion && !rolId ? usuario : undefined);
  const nipOperacionObligatorio = usaNipCaja && !yaTieneNip;

  async function guardar() {
    setError(null);
    setGuardando(true);

    const cuerpo: Record<string, unknown> = { nombre, email };
    if (!usuario?.propio) cuerpo.rolId = rolId || null;
    if (password) cuerpo.password = password;
    if (pideNipSupervisor) cuerpo.nipCreacionSupervisor = nipSupervisor;
    if (usaNipCaja && nipOperacion) cuerpo.nipOperacion = nipOperacion;
    if (esEdicion) {
      if (!usuario?.propio) cuerpo.activo = activo;
      if (usuario!.role === "sucursal") cuerpo.sucursalId = sucursalId || null;
    } else {
      cuerpo.role = role;
      cuerpo.sucursalId = role === "sucursal" ? sucursalId : null;
    }

    const res = await fetch(esEdicion ? `/api/usuarios/${usuario!._id}` : "/api/usuarios", {
      method: esEdicion ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el usuario");
      return;
    }
    onGuardado();
  }

  const faltaCampo =
    !nombre ||
    !email ||
    (!esEdicion && !rolId) ||
    (!esEdicion && (password.length < 6 || (role === "sucursal" && !sucursalId))) ||
    (pideNipSupervisor && nipSupervisor.length !== 6) ||
    (nipOperacionObligatorio && nipOperacion.length !== 6) ||
    (usaNipCaja && !!nipOperacion && nipOperacion.length !== 6);

  return (
    <Modal
      open
      onClose={onClose}
      title={esEdicion ? usuario!.nombre : "Nuevo usuario"}
      icon={UserCog}
      footer={
        <Button onClick={guardar} disabled={guardando || faltaCampo}>
          {guardando ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear usuario"}
        </Button>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <FormField label="Nombre">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </FormField>
          <FormField label="Correo">
            <Input icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        </FormGrid>

        {!esEdicion ? (
          <FormGrid>
            <FormField label="Tipo de usuario">
              <Select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as "matriz" | "sucursal");
                  // El rol elegido deja de aplicar al cambiar de ámbito.
                  setRolId("");
                }}
              >
                <option value="sucursal">De sucursal</option>
                <option value="matriz">De matriz</option>
              </Select>
            </FormField>
            {role === "sucursal" ? (
              <FormField label="Sucursal">
                <Select icon={Store} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                  <option value="">Elige la sucursal</option>
                  {sucursales.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.nombre}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
          </FormGrid>
        ) : usuario!.role === "sucursal" ? (
          <FormField label="Sucursal">
            <Select icon={Store} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Elige la sucursal</option>
              {sucursales.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <FormField label="Puesto / rol">
          <Select aria-label="Puesto / rol" icon={ShieldCheck} value={rolId} onChange={(e) => {
            setRolId(e.target.value);
            const elegido = roles.find((r) => r._id === e.target.value);
            if (!esEdicion && elegido) setRole(elegido.ambito);
          }} disabled={usuario?.propio}>
            <option value="" disabled={!esEdicion}>{esEdicion ? "Perfil heredado" : "Elige el puesto"}</option>
            <optgroup label="Puestos establecidos">
              {rolesDisponibles.filter((r) => r.perfilDocumentoId).map((r) => <option key={r._id} value={r._id}>{r.nombre}</option>)}
            </optgroup>
            <optgroup label="Otros roles existentes">
              {rolesDisponibles.filter((r) => !r.perfilDocumentoId).map((r) => <option key={r._id} value={r._id}>{r.nombre}</option>)}
            </optgroup>
          </Select>
          <p className="mt-1 text-xs text-black/40">
            {usuario?.propio
              ? "No puedes cambiar tu propio rol."
              : rolElegido
                ? rolElegido.descripcion || `Tendrá los permisos definidos en el rol ${rolElegido.nombre}.`
                : esEdicion ? "Sin rol asignado, el usuario conserva los accesos anteriores." : "Elige el puesto para consultar los permisos que tendrá esta persona."}
          </p>
        </FormField>

        {rolElegido ? <div className="rounded-lg border border-black/10 p-3">
          <p className="font-medium text-titos-green-900">Permisos del puesto seleccionado</p>
          <p className="mb-2 text-xs text-black/70">Se aplican automáticamente al asignar este rol. El administrador puede modificarlos en Roles.</p>
          <div className="space-y-2">{PERMISOS.filter((p) => rolElegido.permisos.includes(p.clave)).map((p) => <label key={p.clave} className="flex items-start gap-2 text-sm text-black/80"><input type="checkbox" checked readOnly aria-label={p.etiqueta} /><span>{p.etiqueta}</span></label>)}</div>
          {rolElegido.perfilDocumentoId ? <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900"><strong>Funciones pendientes: </strong>{PUESTOS.find((p) => p.perfilDocumentoId === rolElegido.perfilDocumentoId)?.pendientes}</p> : null}
        </div> : null}

          {usaNipCaja ? <FormField
            label={
              yaTieneNip
                ? "Nuevo NIP personal (6 dígitos, opcional)"
                : "NIP personal (6 dígitos)"
            }
          >
            <Input
              icon={KeyRound}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={nipOperacion}
              onChange={(e) => setNipOperacion(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={yaTieneNip ? "Déjalo vacío para conservar el actual" : "••••••"}
            />
            <p className="mt-1 text-xs text-black/70">
              Administración puede asignar y cambiar el NIP de cada cajero o supervisor de caja. No se comparte entre personas.
              Solo los roles de supervisor pueden autorizar operaciones.
              {yaTieneNip ? " Ya tiene uno asignado." : ""}
            </p>
          </FormField> : null}

        {/* Nombrar encargado a alguien pide además el NIP que matriz guarda en
            Configuración. El servidor lo valida igual. */}
        {pideNipSupervisor ? (
          <FormField label="NIP para crear supervisores (6 dígitos)">
            <Input
              icon={ShieldAlert}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={nipSupervisor}
              onChange={(e) => setNipSupervisor(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
            />
            <p className="mt-1 text-xs text-amber-700">
              <strong>{rolElegido?.nombre}</strong> es un rol de mando: autoriza cancelaciones y retiros. Captura el
              NIP de 6 dígitos que matriz configuró en Configuración → NIP para crear supervisores.
            </p>
          </FormField>
        ) : null}

        <FormField label={esEdicion ? "Nueva contraseña (opcional)" : "Contraseña"}>
          <Input
            icon={KeyRound}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={esEdicion ? "Déjala vacía para no cambiarla" : "Mínimo 6 caracteres"}
          />
        </FormField>

        {esEdicion && !usuario!.propio ? (
          <label className="flex items-center gap-2 text-sm text-black/70">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (puede iniciar sesión)
          </label>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- Roles ---

function RolModal({ rol, onClose, onGuardado }: { rol: Rol | null; onClose: () => void; onGuardado: () => void }) {
  const esEdicion = !!rol;
  const [nombre, setNombre] = useState(rol?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? "");
  const [ambito, setAmbito] = useState<AmbitoRolPermiso>(rol?.ambito ?? "sucursal");
  const [permisos, setPermisos] = useState<string[]>(rol?.permisos ?? []);
  const [esSupervisor, setEsSupervisor] = useState(rol?.esSupervisor ?? false);
  const [nipSupervisor, setNipSupervisor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disponibles = permisosDeAmbito(ambito);
  const grupos = useMemo(() => {
    const mapa = new Map<string, typeof disponibles>();
    for (const p of disponibles) {
      mapa.set(p.grupo, [...(mapa.get(p.grupo) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [disponibles]);

  function alternar(clave: string) {
    setPermisos((prev) => (prev.includes(clave) ? prev.filter((p) => p !== clave) : [...prev, clave]));
  }

  const pideNipSupervisor = esSupervisor && !rol?.esSupervisor;

  async function guardar() {
    setError(null);
    setGuardando(true);

    // Marcar un rol como de supervisor es lo que abre el candado, así que el
    // propio marcado va detrás del mismo NIP. Quitarlo no lo pide: deja de dar
    // acceso, no lo otorga.
    const cuerpo: Record<string, unknown> = esEdicion
      ? { nombre, descripcion, permisos, esSupervisor }
      : { nombre, descripcion, ambito, permisos, esSupervisor };
    if (pideNipSupervisor) cuerpo.nipCreacionSupervisor = nipSupervisor;

    const res = await fetch(esEdicion ? `/api/roles/${rol!._id}` : "/api/roles", {
      method: esEdicion ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el rol");
      return;
    }
    onGuardado();
  }

  async function eliminar() {
    setError(null);
    setEliminando(true);
    const res = await fetch(`/api/roles/${rol!._id}`, { method: "DELETE" });
    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar el rol");
      setConfirmando(false);
      return;
    }
    onGuardado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={esEdicion ? rol!.nombre : "Nuevo rol"}
      icon={ShieldCheck}
      footer={
        confirmando ? (
          <>
            <span className="self-center text-sm text-black/60">¿Eliminar este rol?</span>
            <Button variant="ghost" onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={eliminar} disabled={eliminando}>
              {eliminando ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </>
        ) : (
          <>
            {esEdicion && !rol!.esSistema ? (
              <Button variant="danger" onClick={() => setConfirmando(true)}>
                Eliminar
              </Button>
            ) : null}
            <Button
              onClick={guardar}
              disabled={guardando || !nombre || (pideNipSupervisor && nipSupervisor.length !== 6)}
            >
              {guardando ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear rol"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <FormField label="Nombre del rol">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Encargado de turno" />
          </FormField>
          <FormField label="Ámbito">
            <Select
              value={ambito}
              disabled={esEdicion}
              onChange={(e) => {
                setAmbito(e.target.value as AmbitoRolPermiso);
                setPermisos([]);
              }}
            >
              <option value="sucursal">Sucursal</option>
              <option value="matriz">Matriz</option>
            </Select>
            {esEdicion ? (
              <p className="mt-1 text-xs text-black/40">
                El ámbito no se cambia: los usuarios ya asignados quedarían con permisos del lado equivocado.
              </p>
            ) : null}
          </FormField>
        </FormGrid>

        <FormField label="Descripción">
          <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </FormField>

        <div className="rounded-lg border border-black/10 p-3">
          <label className="flex items-start gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={esSupervisor}
              onChange={(e) => setEsSupervisor(e.target.checked)}
            />
            <span>
              Es un rol de supervisor
              <span className="block text-xs text-black/40">
                Asignárselo a un usuario exigirá el NIP de 6 dígitos que matriz configura en Configuración.
              </span>
            </span>
          </label>

          {pideNipSupervisor ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-black/50">NIP para crear supervisores (6 dígitos)</label>
              <Input
                icon={ShieldAlert}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={nipSupervisor}
                onChange={(e) => setNipSupervisor(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
              />
            </div>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-black/70">
            Permisos ({permisos.length} de {disponibles.length})
          </p>
          <div className="space-y-3 rounded-lg border border-black/10 p-3">
            {grupos.map(([grupo, lista]) => (
              <div key={grupo}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">{grupo}</p>
                <div className="space-y-1">
                  {lista.map((p) => (
                    <label key={p.clave} className="flex items-start gap-2 text-sm text-black/70">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={permisos.includes(p.clave)}
                        onChange={() => alternar(p.clave)}
                      />
                      <span>
                        {p.etiqueta}
                        {p.ayuda ? <span className="block text-xs text-black/40">{p.ayuda}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- Pantalla ---

export function UsuariosRolesManager() {
  const [tab, setTab] = useState<"usuarios" | "roles">("usuarios");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargando, setCargando] = useState(true);

  const [usuarioModal, setUsuarioModal] = useState<Usuario | null>(null);
  const [creandoUsuario, setCreandoUsuario] = useState(false);
  const [rolModal, setRolModal] = useState<Rol | null>(null);
  const [creandoRol, setCreandoRol] = useState(false);

  async function cargar() {
    setCargando(true);
    const res = await fetch("/api/usuarios");
    if (res.ok) {
      const data = await res.json();
      setUsuarios(data.usuarios ?? []);
      setRoles(data.roles ?? []);
      setSucursales(data.sucursales ?? []);
    }
    setCargando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {(["usuarios", "roles"] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setTab(valor)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              tab === valor ? "bg-titos-green-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
            }`}
          >
            {valor === "usuarios" ? `Usuarios (${usuarios.length})` : `Roles (${roles.length})`}
          </button>
        ))}
      </div>

      {tab === "usuarios" ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-titos-green-900">Usuarios del sistema</h2>
            <Button onClick={() => setCreandoUsuario(true)}>+ Nuevo usuario</Button>
          </div>
          <p className="mb-4 text-sm text-black/50">
            Todos los usuarios de matriz y de cada sucursal, en un solo lugar. Los que todavía no tienen un rol
            asignado conservan exactamente los accesos que ya tenían.
          </p>

          {cargando ? (
            <p className="text-sm text-black/50">Cargando...</p>
          ) : usuarios.length === 0 ? (
            <EmptyState message="Todavía no hay usuarios." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Correo</th>
                    <th className="py-2 pr-3">Dónde</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u._id} className={`border-b border-black/5 ${!u.activo ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-3 font-medium">
                        {u.nombre}
                        {u.propio ? <span className="ml-1 text-xs text-titos-green-700">(tú)</span> : null}
                        {!u.activo ? <span className="ml-1 text-xs text-black/40">(inactivo)</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-black/60">{u.email}</td>
                      <td className="py-2 pr-3 text-black/60">
                        {u.role === "matriz" ? "Matriz" : (u.sucursal?.nombre ?? "— sin sucursal —")}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            u.rol ? "bg-titos-green-100 text-titos-green-700" : "bg-black/5 text-black/50"
                          }`}
                        >
                          {rolMostrado(u)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button variant="ghost" onClick={() => setUsuarioModal(u)}>
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-titos-green-900">Roles y permisos</h2>
            <Button onClick={() => setCreandoRol(true)}>+ Nuevo rol</Button>
          </div>
          <p className="mb-4 text-sm text-black/50">
            Un rol es un conjunto de permisos. Lo que un rol no incluye no aparece en el menú y tampoco se puede abrir
            escribiendo la dirección a mano: el servidor lo valida igual.
          </p>

          {cargando ? (
            <p className="text-sm text-black/50">Cargando...</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {roles.map((r) => (
                <button
                  key={r._id}
                  type="button"
                  onClick={() => setRolModal(r)}
                  className="rounded-xl border border-black/10 p-4 text-left transition-colors hover:border-titos-green-500 hover:bg-titos-green-100/40"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-titos-green-900">{r.nombre}</span>
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-black/50">
                      {ETIQUETA_AMBITO[r.ambito]}
                    </span>
                    {r.esSupervisor ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        supervisor
                      </span>
                    ) : null}
                    {r.esSistema ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                        del sistema
                      </span>
                    ) : null}
                  </div>
                  {r.descripcion ? <p className="mb-2 text-sm text-black/50">{r.descripcion}</p> : null}
                  <p className="text-xs text-black/40">
                    {r.permisos.length} de {permisosDeAmbito(r.ambito).length} permisos
                    {r.permisos.length === permisosDeAmbito(r.ambito).length ? " · acceso completo" : ""}
                  </p>
                </button>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs text-black/40">
            El catálogo tiene {PERMISOS.length} permisos en total.
          </p>
        </Card>
      )}

      {creandoUsuario || usuarioModal ? (
        <UsuarioModal
          usuario={usuarioModal}
          roles={roles}
          sucursales={sucursales}
          onClose={() => {
            setCreandoUsuario(false);
            setUsuarioModal(null);
          }}
          onGuardado={() => {
            setCreandoUsuario(false);
            setUsuarioModal(null);
            cargar();
          }}
        />
      ) : null}

      {creandoRol || rolModal ? (
        <RolModal
          rol={rolModal}
          onClose={() => {
            setCreandoRol(false);
            setRolModal(null);
          }}
          onGuardado={() => {
            setCreandoRol(false);
            setRolModal(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
