"use client";

import { useEffect, useState } from "react";
import { CreditCard, Store } from "lucide-react";
import { Button, Card, Input, Select, EmptyState, Modal, FormField, FormGrid, Pagination } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";

type Sucursal = { _id: string; nombre: string };

type Terminal = {
  _id: string;
  alias: string;
  banco: string;
  marca: string;
  numeroSerie: string;
  activo: boolean;
  sucursalId: { _id: string; nombre: string } | string;
};

function nombreSucursal(terminal: Terminal) {
  return typeof terminal.sucursalId === "string" ? "—" : terminal.sucursalId.nombre;
}

function idSucursal(terminal: Terminal) {
  return typeof terminal.sucursalId === "string" ? terminal.sucursalId : terminal.sucursalId._id;
}

function TerminalModal({
  terminal,
  sucursales,
  onClose,
  onGuardada,
}: {
  terminal: Terminal | null;
  sucursales: Sucursal[];
  onClose: () => void;
  onGuardada: () => void;
}) {
  const esEdicion = !!terminal;
  const [sucursalId, setSucursalId] = useState(terminal ? idSucursal(terminal) : "");
  const [alias, setAlias] = useState(terminal?.alias ?? "");
  const [banco, setBanco] = useState(terminal?.banco ?? "");
  const [marca, setMarca] = useState(terminal?.marca ?? "");
  const [numeroSerie, setNumeroSerie] = useState(terminal?.numeroSerie ?? "");
  const [activo, setActivo] = useState(terminal?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setGuardando(true);

    const cuerpo = esEdicion
      ? { alias, banco, marca, numeroSerie, activo }
      : { sucursalId, alias, banco, marca, numeroSerie };

    const res = await fetch(esEdicion ? `/api/terminales/${terminal!._id}` : "/api/terminales", {
      method: esEdicion ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar la terminal");
      return;
    }

    onGuardada();
  }

  async function eliminar() {
    setError(null);
    setEliminando(true);

    const res = await fetch(`/api/terminales/${terminal!._id}`, { method: "DELETE" });

    setEliminando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo eliminar la terminal");
      setConfirmando(false);
      return;
    }

    onGuardada();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={esEdicion ? terminal!.alias : "Nueva terminal"}
      icon={CreditCard}
      footer={
        confirmando ? (
          <>
            <span className="self-center text-sm text-black/60">¿Seguro que quieres eliminarla?</span>
            <Button variant="ghost" onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={eliminar} disabled={eliminando}>
              {eliminando ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </>
        ) : (
          <>
            {esEdicion ? (
              <Button variant="danger" onClick={() => setConfirmando(true)}>
                Eliminar
              </Button>
            ) : null}
            <Button onClick={guardar} disabled={guardando || !alias || (!esEdicion && !sucursalId)}>
              {guardando ? "Guardando..." : esEdicion ? "Guardar cambios" : "Registrar terminal"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        {!esEdicion ? (
          <FormField label="Sucursal donde está la terminal">
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

        <FormField label="Nombre con el que la conoce el cajero">
          <Input
            icon={CreditCard}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="Ej. Azul, Caja 2, La de la entrada"
          />
        </FormField>

        <FormGrid>
          <FormField label="Banco">
            <Input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ej. BBVA, Banorte" />
          </FormField>
          <FormField label="Marca o modelo">
            <Input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ej. Verifone, Clip" />
          </FormField>
        </FormGrid>

        <FormField label="Número de serie o afiliación">
          <Input
            value={numeroSerie}
            onChange={(e) => setNumeroSerie(e.target.value)}
            placeholder="El impreso en la terminal; es con el que el banco identifica los depósitos"
          />
        </FormField>

        {esEdicion ? (
          <label className="flex items-center gap-2 text-sm text-black/70">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activa (aparece en el punto de venta al cobrar con tarjeta)
          </label>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

export function TerminalesManager() {
  const [terminales, setTerminales] = useState<Terminal[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [filtroSucursal, setFiltroSucursal] = useState("");
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Terminal | null>(null);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setCargando(true);
    const [resTerminales, resSucursales] = await Promise.all([
      fetch("/api/terminales?todos=1"),
      fetch("/api/sucursales"),
    ]);
    if (resTerminales.ok) setTerminales(await resTerminales.json());
    if (resSucursales.ok) setSucursales(await resSucursales.json());
    setCargando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, []);

  async function alternarActivo(terminal: Terminal) {
    const res = await fetch(`/api/terminales/${terminal._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !terminal.activo }),
    });
    if (res.ok) cargar();
  }

  const visibles = filtroSucursal ? terminales.filter((t) => idSucursal(t) === filtroSucursal) : terminales;
  const { pagina, paginacion } = usePaginacion(visibles, filtroSucursal);

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Terminales ({visibles.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Select icon={Store} value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)}>
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={() => setCreando(true)}>+ Nueva terminal</Button>
          </div>
        </div>

        <p className="mb-4 text-sm text-black/50">
          Al cobrar con tarjeta el cajero elige con cuál terminal pasó la venta, y el corte desglosa lo cobrado por
          terminal. Eso es lo que permite cuadrar cada depósito contra el estado de cuenta del banco y detectar la que
          está fallando. Mientras una tienda no tenga terminales registradas, sigue pudiendo cobrar con tarjeta sin
          elegir ninguna.
        </p>

        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : visibles.length === 0 ? (
          <EmptyState message="Todavía no hay terminales registradas." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Terminal</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Marca</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Sucursal</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Banco</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Serie / afiliación</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {pagina.map((t) => (
                  <tr key={t._id} className={`border-b border-black/5 ${!t.activo ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {t.alias}
                      {!t.activo ? <span className="ml-1 text-xs text-black/40">(inactiva)</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-black/40">{t.marca || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{nombreSucursal(t)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{t.banco || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{t.numeroSerie || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditando(t)}>
                          Ver / Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => alternarActivo(t)}>
                          {t.activo ? "Desactivar" : "Activar"}
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

      {creando || editando ? (
        <TerminalModal
          terminal={editando}
          sucursales={sucursales}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
          onGuardada={() => {
            setCreando(false);
            setEditando(null);
            cargar();
          }}
        />
      ) : null}
    </div>
  );
}
