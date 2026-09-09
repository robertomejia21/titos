"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  MessageSquarePlus,
  ReceiptText,
  RefreshCw,
  Search,
  Stamp,
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
import { FiltrosSucursalFecha, fechaISO, type SucursalFiltro } from "@/components/matriz/FiltrosSucursalFecha";
import { useZonaHoraria } from "@/components/ZonaHorariaProvider";
import { formatFechaHora } from "@/lib/zonasHorarias";
import { REGIMENES_FISCALES, USOS_CFDI } from "@/lib/facturacion";
import { FORMAS_PAGO_SAT, METODOS_PAGO_SAT } from "@/lib/facturas";

type VentaFacturable = {
  _id: string;
  folio: string;
  fecha: string;
  sucursalId: string;
  sucursalNombre: string;
  clienteId: string | null;
  clienteNombre: string;
  total: number;
  esVentas2: boolean;
  articulos: number;
};

type Receptor = {
  razonSocial: string;
  rfc: string;
  regimenFiscal: string;
  usoCfdi: string;
  codigoPostal: string;
  direccionFiscal: string;
  emailFacturacion: string;
};

type Comentario = { _id?: string; texto: string; usuarioNombre: string; fecha: string };

type Concepto = {
  descripcion: string;
  claveProdServ: string;
  unidad: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
};

type Factura = {
  _id: string;
  folio: string;
  serie: string;
  ventaFolio: string;
  sucursalNombre: string;
  receptor: Receptor;
  conceptos: Concepto[];
  tasaIva: number;
  subtotal: number;
  iva: number;
  total: number;
  formaPago: string;
  metodoPago: string;
  comentarios: Comentario[];
  estado: "generada" | "cancelada";
  motivoCancelacion: string;
  timbrado: { estado: string; uuid: string; proveedor: string };
  creadoPorNombre: string;
  createdAt: string;
};

type ClienteFacturacion = {
  _id: string;
  nombre: string;
  facturacion?: Partial<Receptor>;
};

const RECEPTOR_VACIO: Receptor = {
  razonSocial: "",
  rfc: "",
  regimenFiscal: "",
  usoCfdi: "G03",
  codigoPostal: "",
  direccionFiscal: "",
  emailFacturacion: "",
};

const PAGE_SIZE = 15;

function etiqueta(catalogo: readonly { value: string; label: string }[], value: string) {
  return catalogo.find((c) => c.value === value)?.label ?? value ?? "—";
}

export function FacturasManager() {
  const zonaHoraria = useZonaHoraria();
  const [tab, setTab] = useState<"porFacturar" | "facturas">("porFacturar");
  const [sucursales, setSucursales] = useState<SucursalFiltro[]>([]);

  const [sucursalId, setSucursalId] = useState("");
  const [desde, setDesde] = useState(() => fechaISO(30));
  const [hasta, setHasta] = useState(() => fechaISO());
  const [busqueda, setBusqueda] = useState("");

  const [ventas, setVentas] = useState<VentaFacturable[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandida, setExpandida] = useState<string | null>(null);

  // Alta de factura
  const [ventaAFacturar, setVentaAFacturar] = useState<VentaFacturable | null>(null);
  const [clientes, setClientes] = useState<ClienteFacturacion[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [receptor, setReceptor] = useState<Receptor>(RECEPTOR_VACIO);
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  // Comentario y cancelación sobre una factura existente
  const [comentandoId, setComentandoId] = useState<string | null>(null);
  const [textoComentario, setTextoComentario] = useState("");
  const [facturaACancelar, setFacturaACancelar] = useState<Factura | null>(null);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (sucursalId) params.set("sucursalId", sucursalId);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (busqueda.trim()) params.set("q", busqueda.trim());
    return params.toString();
  }, [sucursalId, desde, hasta, busqueda]);

  const cargar = useCallback(async () => {
    setLoading(true);
    const ruta = tab === "porFacturar" ? "/api/facturas/ventas" : "/api/facturas";
    const res = await fetch(`${ruta}?${query()}`);
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    if (tab === "porFacturar") setVentas(data);
    else setFacturas(data);
    setPage(1);
  }, [tab, query]);

  useEffect(() => {
    fetch("/api/sucursales")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http-error"))))
      .then((data: SucursalFiltro[]) => setSucursales(data))
      .catch(() => setSucursales([]));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga la bandeja cuando cambian filtros o pestaña
    cargar();
  }, [cargar]);

  /** Al facturar, se traen los clientes de la sucursal de esa venta para poder heredar sus datos fiscales. */
  async function abrirAlta(venta: VentaFacturable) {
    setVentaAFacturar(venta);
    setReceptor(RECEPTOR_VACIO);
    setClienteId("");
    setComentario("");
    setErrorAlta(null);

    const res = await fetch(`/api/clientes?sucursalId=${venta.sucursalId}`);
    const lista: ClienteFacturacion[] = res.ok ? await res.json() : [];
    setClientes(lista);

    if (venta.clienteId) {
      const cliente = lista.find((c) => c._id === venta.clienteId);
      if (cliente) aplicarCliente(cliente);
    }
  }

  function aplicarCliente(cliente: ClienteFacturacion) {
    setClienteId(cliente._id);
    const f = cliente.facturacion ?? {};
    setReceptor({
      razonSocial: f.razonSocial || cliente.nombre,
      rfc: f.rfc || "",
      regimenFiscal: f.regimenFiscal || "",
      usoCfdi: f.usoCfdi || "G03",
      codigoPostal: f.codigoPostal || "",
      direccionFiscal: f.direccionFiscal || "",
      emailFacturacion: f.emailFacturacion || "",
    });
  }

  function cambiarCliente(id: string) {
    if (!id) {
      setClienteId("");
      setReceptor(RECEPTOR_VACIO);
      return;
    }
    const cliente = clientes.find((c) => c._id === id);
    if (cliente) aplicarCliente(cliente);
  }

  async function generarFactura() {
    if (!ventaAFacturar) return;
    setErrorAlta(null);
    setGuardando(true);

    const res = await fetch("/api/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ventaId: ventaAFacturar._id,
        clienteId: clienteId || null,
        receptor,
        comentario,
      }),
    });
    setGuardando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorAlta(data.error || "No se pudo generar la factura");
      return;
    }

    setVentaAFacturar(null);
    setTab("facturas");
  }

  async function agregarComentario(id: string) {
    if (!textoComentario.trim()) return;
    setErrorAccion(null);
    setProcesando(true);
    const res = await fetch(`/api/facturas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "comentar", texto: textoComentario.trim() }),
    });
    setProcesando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorAccion(data.error || "No se pudo guardar el comentario");
      return;
    }

    const actualizada: Factura = await res.json();
    setFacturas((prev) => prev.map((f) => (f._id === id ? actualizada : f)));
    setTextoComentario("");
    setComentandoId(null);
  }

  async function cancelarFactura() {
    if (!facturaACancelar) return;
    if (!motivoCancelacion.trim()) {
      setErrorAccion("Captura el motivo de la cancelación");
      return;
    }
    setErrorAccion(null);
    setProcesando(true);
    const res = await fetch(`/api/facturas/${facturaACancelar._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "cancelar", motivo: motivoCancelacion.trim() }),
    });
    setProcesando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorAccion(data.error || "No se pudo cancelar la factura");
      return;
    }

    const actualizada: Factura = await res.json();
    setFacturas((prev) => prev.map((f) => (f._id === actualizada._id ? actualizada : f)));
    setFacturaACancelar(null);
    setMotivoCancelacion("");
  }

  const lista = tab === "porFacturar" ? ventas : facturas;
  const totalPages = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  const totalFacturado = useMemo(
    () => facturas.filter((f) => f.estado === "generada").reduce((sum, f) => sum + f.total, 0),
    [facturas]
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant={tab === "porFacturar" ? "primary" : "ghost"} onClick={() => setTab("porFacturar")}>
          Ventas por facturar
        </Button>
        <Button variant={tab === "facturas" ? "primary" : "ghost"} onClick={() => setTab("facturas")}>
          Facturas emitidas
        </Button>
      </div>

      <FiltrosSucursalFecha
        sucursales={sucursales}
        sucursalId={sucursalId}
        onSucursalId={setSucursalId}
        desde={desde}
        onDesde={setDesde}
        hasta={hasta}
        onHasta={setHasta}
      >
        <FormField label={tab === "porFacturar" ? "Buscar folio o cliente" : "Buscar folio, RFC o razón social"}>
          <Input
            icon={Search}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribe y presiona Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") cargar();
            }}
          />
        </FormField>
      </FiltrosSucursalFecha>

      {tab === "facturas" ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm text-black/50">Facturas vigentes</p>
            <p className="mt-1 text-2xl font-bold text-titos-green-900">
              {facturas.filter((f) => f.estado === "generada").length}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-black/50">Total facturado</p>
            <p className="mt-1 text-2xl font-bold text-titos-green-700">{formatMoney(totalFacturado)}</p>
          </Card>
          <Card>
            <p className="text-sm text-black/50">Canceladas</p>
            <p className="mt-1 text-2xl font-bold text-red-600">
              {facturas.filter((f) => f.estado === "cancelada").length}
            </p>
          </Card>
        </div>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-titos-green-900">
            {tab === "porFacturar" ? "Ventas sin factura" : "Facturas del sistema"}
          </h2>
          <Button variant="ghost" onClick={cargar} disabled={loading}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </span>
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-black/50">Cargando...</p>
        ) : lista.length === 0 ? (
          <EmptyState
            message={
              tab === "porFacturar"
                ? "No hay ventas pendientes de facturar con estos filtros."
                : "Todavía no se han generado facturas con estos filtros."
            }
          />
        ) : tab === "porFacturar" ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="py-2 pr-3">Folio</th>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Sucursal</th>
                    <th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3 text-right">Artículos</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ventas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((v) => (
                    <tr key={v._id} className="border-b border-black/5">
                      <td className="py-2 pr-3 font-medium text-titos-green-900">
                        {v.folio}
                        {v.esVentas2 ? (
                          <span className="ml-1.5 rounded-full bg-titos-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-titos-orange-700">
                            NV
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-black/55">{formatFechaHora(v.fecha, zonaHoraria, "—")}</td>
                      <td className="py-2 pr-3 text-black/70">{v.sucursalNombre}</td>
                      <td className="py-2 pr-3 text-black/55">{v.clienteNombre || "Público en general"}</td>
                      <td className="py-2 pr-3 text-right text-black/55">{v.articulos}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-titos-green-900">
                        {formatMoney(v.total)}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" onClick={() => abrirAlta(v)}>
                          Facturar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={ventas.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        ) : (
          <>
            <ul className="divide-y divide-black/5">
              {facturas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((f) => {
                const abierta = expandida === f._id;
                return (
                  <li key={f._id}>
                    <button
                      type="button"
                      onClick={() => setExpandida(abierta ? null : f._id)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-left text-sm hover:bg-black/2"
                    >
                      <span className="flex items-center gap-2 font-medium text-titos-green-900">
                        {abierta ? (
                          <ChevronDown className="h-4 w-4 text-black/30" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-black/30" />
                        )}
                        {f.serie}-{f.folio}
                      </span>
                      <span className="truncate text-black/70">{f.receptor.razonSocial}</span>
                      <span className="font-mono text-xs text-black/50">{f.receptor.rfc}</span>
                      <span className="text-xs text-black/45">{formatFechaHora(f.createdAt, zonaHoraria, "—")}</span>
                      <span className="text-xs text-black/45">Venta {f.ventaFolio}</span>
                      <span className="font-semibold text-titos-green-900">{formatMoney(f.total)}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          f.estado === "cancelada"
                            ? "bg-red-100 text-red-700"
                            : "bg-titos-green-100 text-titos-green-700"
                        }`}
                      >
                        {f.estado}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-black/55">
                        <Stamp className="h-3 w-3" />
                        {f.timbrado?.estado === "timbrada" ? "Timbrada" : "Sin timbrar"}
                      </span>
                    </button>

                    {abierta ? (
                      <div className="space-y-4 pb-5 text-sm">
                        <div className="grid grid-cols-1 gap-3 rounded-lg bg-black/2 p-3 sm:grid-cols-2">
                          <p>
                            <span className="text-black/45">Régimen:</span>{" "}
                            {etiqueta(REGIMENES_FISCALES, f.receptor.regimenFiscal)}
                          </p>
                          <p>
                            <span className="text-black/45">Uso CFDI:</span> {etiqueta(USOS_CFDI, f.receptor.usoCfdi)}
                          </p>
                          <p>
                            <span className="text-black/45">Forma de pago:</span>{" "}
                            {etiqueta(FORMAS_PAGO_SAT, f.formaPago)}
                          </p>
                          <p>
                            <span className="text-black/45">Método de pago:</span>{" "}
                            {etiqueta(METODOS_PAGO_SAT, f.metodoPago)}
                          </p>
                          <p>
                            <span className="text-black/45">CP fiscal:</span> {f.receptor.codigoPostal || "—"}
                          </p>
                          <p>
                            <span className="text-black/45">Correo:</span> {f.receptor.emailFacturacion || "—"}
                          </p>
                          <p>
                            <span className="text-black/45">Sucursal:</span> {f.sucursalNombre || "—"}
                          </p>
                          <p>
                            <span className="text-black/45">Emitió:</span> {f.creadoPorNombre || "—"}
                          </p>
                        </div>

                        <ul className="divide-y divide-black/5 rounded-lg border border-black/10 px-3">
                          {f.conceptos.map((c, idx) => (
                            <li key={idx} className="flex items-center justify-between py-1.5">
                              <span>
                                {c.descripcion} × {c.cantidad} {c.unidad}
                                <span className="ml-2 text-xs text-black/35">{formatMoney(c.valorUnitario)} c/u</span>
                              </span>
                              <span className="font-medium">{formatMoney(c.importe)}</span>
                            </li>
                          ))}
                          <li className="flex items-center justify-between py-1.5 text-black/60">
                            <span>Subtotal</span>
                            <span>{formatMoney(f.subtotal)}</span>
                          </li>
                          <li className="flex items-center justify-between py-1.5 text-black/60">
                            <span>IVA {f.tasaIva}%</span>
                            <span>{formatMoney(f.iva)}</span>
                          </li>
                          <li className="flex items-center justify-between py-1.5 font-semibold text-titos-green-900">
                            <span>Total</span>
                            <span>{formatMoney(f.total)}</span>
                          </li>
                        </ul>

                        {f.estado === "cancelada" ? (
                          <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
                            Cancelada: {f.motivoCancelacion}
                          </p>
                        ) : null}

                        <div>
                          <p className="mb-2 font-medium text-black/70">Comentarios</p>
                          {f.comentarios.length === 0 ? (
                            <p className="text-black/40">Sin comentarios.</p>
                          ) : (
                            <ul className="space-y-2">
                              {f.comentarios.map((c, idx) => (
                                <li key={c._id ?? idx} className="rounded-lg bg-black/2 px-3 py-2">
                                  <p className="text-black/75">{c.texto}</p>
                                  <p className="mt-0.5 text-xs text-black/40">
                                    {c.usuarioNombre} · {formatFechaHora(c.fecha, zonaHoraria, "—")}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}

                          {comentandoId === f._id ? (
                            <div className="mt-3 space-y-2">
                              <Input
                                autoFocus
                                value={textoComentario}
                                onChange={(e) => setTextoComentario(e.target.value)}
                                placeholder="Escribe el comentario..."
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") agregarComentario(f._id);
                                }}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => agregarComentario(f._id)} disabled={procesando}>
                                  Guardar
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setComentandoId(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {errorAccion ? <p className="text-sm text-red-600">{errorAccion}</p> : null}

                        <div className="flex flex-wrap gap-2 border-t border-black/5 pt-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setTextoComentario("");
                              setErrorAccion(null);
                              setComentandoId(f._id);
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <MessageSquarePlus className="h-4 w-4" />
                              Agregar comentario
                            </span>
                          </Button>
                          <a href={`/api/facturas/${f._id}/pdf`} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="secondary">
                              <span className="flex items-center gap-1.5">
                                <Download className="h-4 w-4" />
                                Descargar PDF
                              </span>
                            </Button>
                          </a>
                          {f.estado === "generada" ? (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setMotivoCancelacion("");
                                setErrorAccion(null);
                                setFacturaACancelar(f);
                              }}
                            >
                              Cancelar factura
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={facturas.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <Card className="mt-6 border-sky-200 bg-sky-50/50">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-titos-green-900">
          <Stamp className="h-4.5 w-4.5 text-sky-700" />
          Siguiente fase: timbrado ante el SAT
        </h2>
        <p className="text-sm text-black/70">
          Las facturas actuales son documentos internos sin timbre fiscal. La integración y la validación de los
          datos fiscales siguen pendientes. Esta comparación cubre el servicio de timbrado; no incluye desarrollo.
        </p>
        <p className="mt-3 text-sm font-medium">Costos consultados el 9 de septiembre de 2026 · MXN, IVA incluido</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-black/15"><th className="p-2">Proveedor</th><th className="p-2">Cuota</th><th className="p-2">Consumo</th></tr></thead>
            <tbody>
              <tr className="border-b border-black/10"><th scope="row" className="p-2 font-medium"><a href="https://api.facturama.mx/costos" target="_blank" rel="noreferrer" className="text-titos-green-700 underline">Facturama API</a></th><td className="p-2">$1,650 al año; incluye 100 folios</td><td className="p-2">$0.50 por folio adicional en compras de 1 a 10,000; prepago</td></tr>
              <tr><th scope="row" className="p-2 font-medium"><a href="https://www.facturapi.io/pricing" target="_blank" rel="noreferrer" className="text-titos-green-700 underline">Facturapi API CFDI</a></th><td className="p-2">$299 al mes</td><td className="p-2">$0.60 por timbre</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-black/70">Antes de contratar, confirmar volumen de facturas, RFC emisores, vigencia de folios y condiciones de cancelación. Las tarifas enlazadas pueden cambiar.</p>
      </Card>

      {ventaAFacturar ? (
        <Modal
          open
          onClose={() => setVentaAFacturar(null)}
          title={`Facturar venta ${ventaAFacturar.folio}`}
          icon={ReceiptText}
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setVentaAFacturar(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={generarFactura} disabled={guardando}>
                {guardando ? "Generando..." : "Generar factura"}
              </Button>
            </>
          }
        >
          <p className="mb-4 rounded-lg bg-black/2 px-3 py-2 text-sm text-black/60">
            {ventaAFacturar.sucursalNombre} · {formatFechaHora(ventaAFacturar.fecha, zonaHoraria, "—")} ·{" "}
            <strong className="text-titos-green-900">{formatMoney(ventaAFacturar.total)}</strong>
          </p>

          <FormField label="Cliente registrado (opcional)" className="mb-4">
            <Select value={clienteId} onChange={(e) => cambiarCliente(e.target.value)}>
              <option value="">Capturar los datos fiscales a mano</option>
              {clientes.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.nombre}
                  {c.facturacion?.rfc ? ` — ${c.facturacion.rfc}` : " (sin datos fiscales)"}
                </option>
              ))}
            </Select>
          </FormField>

          <FormGrid>
            <FormField label="Razón social">
              <Input
                value={receptor.razonSocial}
                onChange={(e) => setReceptor({ ...receptor, razonSocial: e.target.value })}
                placeholder="Como aparece en la constancia"
              />
            </FormField>
            <FormField label="RFC">
              <Input
                value={receptor.rfc}
                onChange={(e) => setReceptor({ ...receptor, rfc: e.target.value.toUpperCase() })}
                placeholder="XAXX010101000"
              />
            </FormField>
            <FormField label="Régimen fiscal">
              <Select
                value={receptor.regimenFiscal}
                onChange={(e) => setReceptor({ ...receptor, regimenFiscal: e.target.value })}
              >
                <option value="">Selecciona...</option>
                {REGIMENES_FISCALES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Uso de CFDI">
              <Select value={receptor.usoCfdi} onChange={(e) => setReceptor({ ...receptor, usoCfdi: e.target.value })}>
                <option value="">Selecciona...</option>
                {USOS_CFDI.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Código postal fiscal">
              <Input
                value={receptor.codigoPostal}
                onChange={(e) => setReceptor({ ...receptor, codigoPostal: e.target.value.replace(/\D/g, "") })}
                maxLength={5}
                placeholder="22000"
              />
            </FormField>
            <FormField label="Correo para enviar la factura">
              <Input
                type="email"
                value={receptor.emailFacturacion}
                onChange={(e) => setReceptor({ ...receptor, emailFacturacion: e.target.value })}
                placeholder="facturacion@empresa.com"
              />
            </FormField>
          </FormGrid>

          <FormField label="Dirección fiscal (opcional)" className="mt-3.5">
            <Input
              value={receptor.direccionFiscal}
              onChange={(e) => setReceptor({ ...receptor, direccionFiscal: e.target.value })}
            />
          </FormField>

          <FormField label="Comentario inicial (opcional)" className="mt-3.5">
            <Input
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej. el cliente pidió factura el mismo día"
            />
          </FormField>

          {errorAlta ? <p className="mt-3 text-sm text-red-600">{errorAlta}</p> : null}
        </Modal>
      ) : null}

      {facturaACancelar ? (
        <Modal
          open
          onClose={() => setFacturaACancelar(null)}
          title="Cancelar factura"
          icon={ReceiptText}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFacturaACancelar(null)} disabled={procesando}>
                Regresar
              </Button>
              <Button variant="danger" onClick={cancelarFactura} disabled={procesando}>
                {procesando ? "Cancelando..." : "Cancelar factura"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-black/70">
            Se cancela la factura <strong>{facturaACancelar.serie}-{facturaACancelar.folio}</strong> por{" "}
            {formatMoney(facturaACancelar.total)}. La venta {facturaACancelar.ventaFolio} vuelve a quedar disponible
            para facturarse.
          </p>
          <FormField label="Motivo de la cancelación">
            <Input
              autoFocus
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
              placeholder="Ej. datos fiscales equivocados"
            />
          </FormField>
          {errorAccion ? <p className="mt-3 text-sm text-red-600">{errorAccion}</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}
