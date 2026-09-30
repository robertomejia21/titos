"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  User,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Receipt,
  Search,
  TriangleAlert,
  Wallet,
  CalendarClock,
  FileUp,
} from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  FormField,
  FormGrid,
  Input,
  Modal,
  Pagination,
  Select,
  formatMoney,
} from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { REGIMENES_FISCALES, USOS_CFDI } from "@/lib/facturacion";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import {
  estadoCredito,
  formatFecha,
  type ClienteConCredito,
  type ResumenCredito,
} from "@/lib/creditoCliente";

type Cuenta = {
  _id: string;
  folio: string;
  fecha: string;
  fechaVencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  vencida: boolean;
};

type Abono = {
  _id: string;
  fecha: string;
  monto: number;
  metodoPago: string;
  notas: string;
  aplicaciones: { folio: string; monto: number }[];
};

const FORM_VACIO = {
  nombre: "",
  telefono: "",
  email: "",
  direccion: "",
  notas: "",
  activo: true,
  credito: { activo: false, limite: "", diasCredito: "30" },
  facturacion: {
    razonSocial: "",
    rfc: "",
    regimenFiscal: "",
    usoCfdi: "",
    codigoPostal: "",
    direccionFiscal: "",
    emailFacturacion: "",
  },
};

type FormState = typeof FORM_VACIO;

function clienteAForm(cliente: ClienteConCredito): FormState {
  return {
    nombre: cliente.nombre,
    telefono: cliente.telefono ?? "",
    email: cliente.email ?? "",
    direccion: cliente.direccion ?? "",
    notas: cliente.notas ?? "",
    activo: cliente.activo,
    credito: {
      activo: cliente.credito?.activo ?? false,
      limite: cliente.credito?.limite ? String(cliente.credito.limite) : "",
      diasCredito: String(cliente.credito?.diasCredito ?? 30),
    },
    facturacion: {
      razonSocial: cliente.facturacion?.razonSocial ?? "",
      rfc: cliente.facturacion?.rfc ?? "",
      regimenFiscal: cliente.facturacion?.regimenFiscal ?? "",
      usoCfdi: cliente.facturacion?.usoCfdi ?? "",
      codigoPostal: cliente.facturacion?.codigoPostal ?? "",
      direccionFiscal: cliente.facturacion?.direccionFiscal ?? "",
      emailFacturacion: cliente.facturacion?.emailFacturacion ?? "",
    },
  };
}

function formAPayload(form: FormState) {
  return {
    nombre: form.nombre,
    telefono: form.telefono,
    email: form.email,
    direccion: form.direccion,
    notas: form.notas,
    activo: form.activo,
    credito: {
      activo: form.credito.activo,
      limite: Number(form.credito.limite) || 0,
      diasCredito: Number(form.credito.diasCredito) || 30,
    },
    facturacion: form.facturacion,
  };
}

type DatosConstancia = {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  regimenesDetectados: { clave: string; nombre: string }[];
  codigoPostal: string;
  direccionFiscal: string;
  email: string;
  telefono: string;
  faltantes: string[];
};

/**
 * Sube el PDF de la constancia de situación fiscal del SAT y precarga con él el
 * formulario del cliente. Lo que no se alcance a leer se avisa para capturarlo a
 * mano; nunca se guarda nada sin que el usuario confirme.
 */
function CargarConstancia({ onLeida }: { onLeida: (datos: DatosConstancia) => void }) {
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function subir(archivo: File) {
    setError(null);
    setAviso(null);
    setLeyendo(true);

    const datos = new FormData();
    datos.append("archivo", archivo);

    try {
      const res = await fetch("/api/clientes/constancia", { method: "POST", body: datos });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "No se pudo leer la constancia");
        return;
      }

      const leidos: DatosConstancia = await res.json();
      onLeida(leidos);
      setAviso(
        leidos.faltantes.length > 0
          ? `Datos cargados. Revisa y captura a mano: ${leidos.faltantes.join(", ")}.`
          : "Datos fiscales cargados desde la constancia. Revísalos antes de guardar."
      );
    } catch {
      setError("Se perdió la conexión al subir el archivo");
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-dashed border-titos-green-600/40 bg-titos-green-100/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-titos-green-900">Alta desde constancia fiscal</p>
          <p className="text-xs text-black/50">
            Sube el PDF de la Constancia de Situación Fiscal del SAT y se llenan solos el RFC, la razón social, el
            régimen, el código postal y el domicilio.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={leyendo}>
          <span className="flex items-center gap-1.5">
            <FileUp className="h-4 w-4" />
            {leyendo ? "Leyendo PDF..." : "Subir PDF"}
          </span>
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) subir(archivo);
        }}
      />

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {aviso ? <p className="mt-2 text-sm text-titos-green-700">{aviso}</p> : null}
    </div>
  );
}

function ClienteFormModal({
  cliente,
  onClose,
  onGuardado,
}: {
  cliente: ClienteConCredito | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [form, setForm] = useState<FormState>(cliente ? clienteAForm(cliente) : FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }
  function setCredito(campo: keyof FormState["credito"], valor: string | boolean) {
    setForm((prev) => ({ ...prev, credito: { ...prev.credito, [campo]: valor } }));
  }
  function setFacturacion(campo: keyof FormState["facturacion"], valor: string) {
    setForm((prev) => ({ ...prev, facturacion: { ...prev.facturacion, [campo]: valor } }));
  }

  /**
   * Vuelca lo leído de la constancia al formulario. Solo pisa los campos que la
   * constancia sí trae, para no borrar lo que el usuario ya hubiera capturado.
   */
  function aplicarConstancia(datos: DatosConstancia) {
    setForm((prev) => ({
      ...prev,
      nombre: prev.nombre.trim() || datos.razonSocial,
      telefono: prev.telefono.trim() || datos.telefono,
      email: prev.email.trim() || datos.email,
      direccion: prev.direccion.trim() || datos.direccionFiscal,
      facturacion: {
        ...prev.facturacion,
        razonSocial: datos.razonSocial || prev.facturacion.razonSocial,
        rfc: datos.rfc || prev.facturacion.rfc,
        regimenFiscal: datos.regimenFiscal || prev.facturacion.regimenFiscal,
        // La constancia no dice para qué se usará la factura; G03 (gastos en
        // general) es lo que aplica en un abarrote y se puede cambiar.
        usoCfdi: prev.facturacion.usoCfdi || "G03",
        codigoPostal: datos.codigoPostal || prev.facturacion.codigoPostal,
        direccionFiscal: datos.direccionFiscal || prev.facturacion.direccionFiscal,
        emailFacturacion: datos.email || prev.facturacion.emailFacturacion,
      },
    }));
  }

  async function guardar() {
    setError(null);
    setGuardando(true);

    const res = await fetch(cliente ? `/api/clientes/${cliente._id}` : "/api/clientes", {
      method: cliente ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formAPayload(form)),
    });

    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el cliente");
      return;
    }

    onGuardado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={cliente ? `Editar ${cliente.nombre}` : "Nuevo cliente"}
      icon={User}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !form.nombre.trim()}>
            {guardando ? "Guardando..." : cliente ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="Nombre del cliente" className="sm:col-span-2">
            <Input icon={User} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
          </FormField>
          <FormField label="Teléfono">
            <Input icon={Phone} value={form.telefono} onChange={(e) => set("telefono", e.target.value)} />
          </FormField>
          <FormField label="Correo">
            <Input icon={Mail} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </FormField>
          <FormField label="Dirección" className="sm:col-span-2">
            <Input icon={MapPin} value={form.direccion} onChange={(e) => set("direccion", e.target.value)} />
          </FormField>
        </FormGrid>

        <label className="flex items-center gap-2 text-sm text-black/70">
          <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
          Cliente activo
        </label>

        <div className="rounded-xl border border-black/10 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">
            <CreditCard className="h-3.5 w-3.5" /> Crédito
          </p>

          <label className="mb-3 flex items-center gap-2 text-sm text-black/70">
            <input
              type="checkbox"
              checked={form.credito.activo}
              onChange={(e) => setCredito("activo", e.target.checked)}
            />
            Este cliente tiene crédito autorizado
          </label>

          {form.credito.activo ? (
            <FormGrid>
              <FormField label="Límite de crédito">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.credito.limite}
                  onChange={(e) => setCredito("limite", e.target.value)}
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="Plazo de pago (días)">
                <Input
                  icon={CalendarClock}
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={form.credito.diasCredito}
                  onChange={(e) => setCredito("diasCredito", e.target.value)}
                />
              </FormField>
              <p className="text-xs text-black/40 sm:col-span-2">
                Cada venta a crédito vence a los {Number(form.credito.diasCredito) || 30} días de hecha. Si el cliente
                deja pasar una fecha de vencimiento sin liquidar, el punto de venta le bloquea el crédito hasta que se
                ponga al corriente.
              </p>
            </FormGrid>
          ) : null}
        </div>

        <div className="rounded-xl border border-black/10 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">
            <Receipt className="h-3.5 w-3.5" /> Datos de facturación
          </p>

          <CargarConstancia onLeida={aplicarConstancia} />

          <FormGrid>
            <FormField label="Razón social" className="sm:col-span-2">
              <Input
                value={form.facturacion.razonSocial}
                onChange={(e) => setFacturacion("razonSocial", e.target.value)}
              />
            </FormField>
            <FormField label="RFC">
              <Input
                value={form.facturacion.rfc}
                onChange={(e) => setFacturacion("rfc", e.target.value.toUpperCase())}
                placeholder="XAXX010101000"
              />
            </FormField>
            <FormField label="Código postal fiscal">
              <Input
                value={form.facturacion.codigoPostal}
                onChange={(e) => setFacturacion("codigoPostal", e.target.value)}
                placeholder="21000"
              />
            </FormField>
            <FormField label="Régimen fiscal" className="sm:col-span-2">
              <Select
                value={form.facturacion.regimenFiscal}
                onChange={(e) => setFacturacion("regimenFiscal", e.target.value)}
              >
                <option value="">Sin especificar</option>
                {REGIMENES_FISCALES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Uso de CFDI" className="sm:col-span-2">
              <Select value={form.facturacion.usoCfdi} onChange={(e) => setFacturacion("usoCfdi", e.target.value)}>
                <option value="">Sin especificar</option>
                {USOS_CFDI.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Dirección fiscal" className="sm:col-span-2">
              <Input
                icon={MapPin}
                value={form.facturacion.direccionFiscal}
                onChange={(e) => setFacturacion("direccionFiscal", e.target.value)}
              />
            </FormField>
            <FormField label="Correo para facturas" className="sm:col-span-2">
              <Input
                icon={Mail}
                type="email"
                value={form.facturacion.emailFacturacion}
                onChange={(e) => setFacturacion("emailFacturacion", e.target.value)}
              />
            </FormField>
          </FormGrid>
        </div>

        <FormField label="Notas internas">
          <Input value={form.notas} onChange={(e) => set("notas", e.target.value)} />
        </FormField>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

function EstadoCuentaModal({
  cliente,
  onClose,
  onCambio,
}: {
  cliente: ClienteConCredito;
  onClose: () => void;
  onCambio: () => void;
}) {
  const zonaHoraria = useZonaHoraria();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [abonos, setAbonos] = useState<Abono[]>([]);
  const [resumen, setResumen] = useState<ResumenCredito>(cliente.resumen);
  const [cargando, setCargando] = useState(true);

  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [notas, setNotas] = useState("");
  const [abonando, setAbonando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const { pagina: paginaCuentas, paginacion: paginacionCuentas } = usePaginacion(cuentas);
  const { pagina: paginaAbonos, paginacion: paginacionAbonos } = usePaginacion(abonos);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch(`/api/clientes/${cliente._id}`);
    setCargando(false);
    if (!res.ok) return;
    const data = await res.json();
    setCuentas(data.cuentas ?? []);
    setAbonos(data.abonos ?? []);
    setResumen(data.resumen);
  }, [cliente._id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del estado de cuenta
    cargar();
  }, [cargar]);

  async function registrarAbono() {
    setError(null);
    setOk(null);
    setAbonando(true);

    const res = await fetch(`/api/clientes/${cliente._id}/abonos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto: Number(monto), metodoPago, notas }),
    });

    setAbonando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo registrar el abono");
      return;
    }

    setMonto("");
    setNotas("");
    setOk("Abono registrado.");
    await cargar();
    onCambio();
  }

  const pendientes = cuentas.filter((c) => c.estado === "pendiente");
  const montoValido = Number(monto) > 0 && Number(monto) <= resumen.saldo + 0.005;

  return (
    <Modal open onClose={onClose} title={`Estado de cuenta — ${cliente.nombre}`} icon={Wallet} size="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-black/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Límite</p>
            <p className="text-xl font-bold text-titos-green-900">{formatMoney(resumen.limite)}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Debe</p>
            <p className="text-xl font-bold text-black/80">{formatMoney(resumen.saldo)}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Disponible</p>
            <p className="text-xl font-bold text-titos-green-700">{formatMoney(resumen.disponible)}</p>
          </div>
          <div className={`rounded-xl border p-3 ${resumen.tieneVencidos ? "border-red-200 bg-red-50" : "border-black/10"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Vencido</p>
            <p className={`text-xl font-bold ${resumen.tieneVencidos ? "text-red-600" : "text-black/40"}`}>
              {formatMoney(resumen.saldoVencido)}
            </p>
          </div>
        </div>

        {resumen.tieneVencidos ? (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Este cliente tiene {resumen.cuentasVencidas} {resumen.cuentasVencidas === 1 ? "venta vencida" : "ventas vencidas"}.
            No podrá comprar a crédito hasta liquidar {formatMoney(resumen.saldoVencido)}.
          </p>
        ) : resumen.proximoVencimiento ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            Próximo pago: {formatFecha(resumen.proximoVencimiento, zonaHoraria)}
          </p>
        ) : null}

        {resumen.saldo > 0 ? (
          <div className="rounded-xl border border-black/10 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-black/40">Registrar abono</p>
            <FormGrid>
              <FormField label="Monto">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="Forma de pago">
                <Select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </Select>
              </FormField>
              <FormField label="Referencia o nota" className="sm:col-span-2">
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
              </FormField>
            </FormGrid>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={registrarAbono} disabled={abonando || !montoValido}>
                {abonando ? "Registrando..." : "Registrar abono"}
              </Button>
              <button
                type="button"
                onClick={() => setMonto(String(resumen.saldo))}
                className="text-xs font-medium text-titos-green-700 hover:underline"
              >
                Liquidar todo ({formatMoney(resumen.saldo)})
              </button>
              <span className="text-xs text-black/40">
                El abono se aplica primero a las ventas más próximas a vencer. En efectivo entra al corte de caja.
              </span>
            </div>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            {ok ? <p className="mt-2 text-sm text-titos-green-700">{ok}</p> : null}
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
            Ventas a crédito ({pendientes.length} abiertas)
          </p>
          {cargando ? (
            <p className="text-sm text-black/50">Cargando...</p>
          ) : cuentas.length === 0 ? (
            <EmptyState message="Este cliente todavía no tiene ventas a crédito." />
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="px-2 py-1.5 text-xs font-medium">Folio</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Fecha</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Vence</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Monto</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Saldo</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaCuentas.map((c) => (
                    <tr key={c._id} className="border-b border-black/5">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{c.folio}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{formatFecha(c.fecha, zonaHoraria)}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${c.vencida ? "font-semibold text-red-600" : "text-black/60"}`}>
                        {formatFecha(c.fechaVencimiento, zonaHoraria)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatMoney(c.monto)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{formatMoney(c.saldo)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            c.estado === "pagada"
                              ? "bg-titos-green-100 text-titos-green-700"
                              : c.estado === "cancelada"
                                ? "bg-black/5 text-black/50"
                                : c.vencida
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {c.estado === "pendiente" ? (c.vencida ? "Vencida" : "Pendiente") : c.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paginacionCuentas} />
            </>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">Abonos ({abonos.length})</p>
          {abonos.length === 0 ? (
            <EmptyState message="Sin abonos registrados." />
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="px-2 py-1.5 text-xs font-medium">Fecha</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Monto</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Forma</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Aplicado a</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaAbonos.map((a) => {
                    const aplicado = a.aplicaciones.map((ap) => ap.folio).join(", ") || "—";
                    return (
                      <tr key={a._id} className="border-b border-black/5">
                        <td className="whitespace-nowrap px-2 py-1.5 text-black/60">{formatFecha(a.fecha, zonaHoraria)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-titos-green-700">{formatMoney(a.monto)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">{a.metodoPago}</td>
                        <td className="max-w-[12rem] truncate px-2 py-1.5 font-mono text-xs text-black/50" title={aplicado}>
                          {aplicado}
                        </td>
                        <td className="max-w-[16rem] truncate px-2 py-1.5 text-black/50" title={a.notas || undefined}>
                          {a.notas || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...paginacionAbonos} />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ClientesManager() {
  const zonaHoraria = useZonaHoraria();
  const [clientes, setClientes] = useState<ClienteConCredito[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<ClienteConCredito | null>(null);
  const [estadoCuenta, setEstadoCuenta] = useState<ClienteConCredito | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/clientes");
    setCargando(false);
    if (res.ok) setClientes(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos al montar
    cargar();
  }, [cargar]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      [c.nombre, c.telefono, c.email, c.facturacion?.rfc, c.facturacion?.razonSocial]
        .filter(Boolean)
        .some((campo) => campo!.toLowerCase().includes(q))
    );
  }, [clientes, busqueda]);
  const { pagina, paginacion } = usePaginacion(filtrados, busqueda);

  const totales = useMemo(
    () => ({
      cartera: clientes.reduce((sum, c) => sum + c.resumen.saldo, 0),
      vencido: clientes.reduce((sum, c) => sum + c.resumen.saldoVencido, 0),
      conCredito: clientes.filter((c) => c.resumen.creditoActivo).length,
    }),
    [clientes]
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Cartera por cobrar</p>
          <p className="text-2xl font-bold text-titos-green-900">{formatMoney(totales.cartera)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Vencido</p>
          <p className={`text-2xl font-bold ${totales.vencido > 0 ? "text-red-600" : "text-black/40"}`}>
            {formatMoney(totales.vencido)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Clientes con crédito</p>
          <p className="text-2xl font-bold text-titos-green-900">{totales.conCredito}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">Clientes ({clientes.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Input
                icon={Search}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, teléfono o RFC"
              />
            </div>
            <Button onClick={() => setCreando(true)}>+ Nuevo cliente</Button>
          </div>
        </div>

        {cargando ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : filtrados.length === 0 ? (
          <EmptyState
            message={busqueda ? "Ningún cliente coincide con la búsqueda." : "Todavía no has dado de alta clientes."}
          />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/50">
                  <th className="px-2 py-1.5 text-xs font-medium">Cliente</th>
                  <th className="px-2 py-1.5 text-xs font-medium">RFC</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Contacto</th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium">Límite</th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium">Debe</th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium">Disponible</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Próximo pago</th>
                  <th className="px-2 py-1.5 text-xs font-medium">Estado</th>
                  <th className="w-px px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {pagina.map((c) => {
                  const estado = estadoCredito(c.resumen);
                  return (
                    <tr key={c._id} className={`border-b border-black/5 ${!c.activo ? "opacity-50" : ""}`}>
                      <td className="max-w-[16rem] truncate px-2 py-1.5 font-medium" title={c.nombre}>
                        {c.nombre}
                        {!c.activo ? <span className="ml-1 text-xs text-black/40">(inactivo)</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs text-black/40">
                        {c.facturacion?.rfc || "—"}
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5 text-black/60" title={c.telefono || c.email || undefined}>
                        {c.telefono || c.email || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-black/60">
                        {c.resumen.creditoActivo ? formatMoney(c.resumen.limite) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">
                        {c.resumen.saldo > 0 ? formatMoney(c.resumen.saldo) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-titos-green-700">
                        {c.resumen.creditoActivo ? formatMoney(c.resumen.disponible) : "—"}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${c.resumen.tieneVencidos ? "text-red-600" : "text-black/60"}`}>
                        {c.resumen.tieneVencidos ? "Vencido" : formatFecha(c.resumen.proximoVencimiento, zonaHoraria)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${estado.className}`}>
                          {estado.label}
                        </span>
                      </td>
                      <td className="w-px whitespace-nowrap px-2 py-1.5 text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" className="w-24" onClick={() => setEstadoCuenta(c)}>
                            Estado cuenta
                          </Button>
                          <Button size="sm" variant="ghost" className="w-16" onClick={() => setEditando(c)}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...paginacion} />
          </>
        )}
      </Card>

      {creando ? (
        <ClienteFormModal
          cliente={null}
          onClose={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            cargar();
          }}
        />
      ) : null}

      {editando ? (
        <ClienteFormModal
          cliente={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      ) : null}

      {estadoCuenta ? (
        <EstadoCuentaModal cliente={estadoCuenta} onClose={() => setEstadoCuenta(null)} onCambio={cargar} />
      ) : null}
    </div>
  );
}
