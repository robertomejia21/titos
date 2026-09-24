"use client";

import { FacturaGlobalManager } from "./FacturaGlobalManager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportarExcelButton } from "@/components/ExportarExcelButton";
import { excelFacturas, excelPorFacturar } from "@/lib/exportacionesFinancieras";
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
import { MOTIVOS_CANCELACION, FORMAS_PAGO_SAT, METODOS_PAGO_SAT, etiquetaImpuestos } from "@/lib/facturas";

export type VentaFacturable = {
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

/** Lo que se ve en el modal antes de facturar: qué se vendió exactamente. */
type VentaDetalle = {
  _id: string;
  folio: string;
  fecha: string;
  clienteNombre?: string;
  total: number;
  baseGravable?: number;
  totalIeps?: number;
  totalIva?: number;
  items: {
    sku: string;
    nombreProducto: string;
    unidad: string;
    cantidad: number;
    precioUnitario: number;
    subtotal: number;
    descuento?: number;
    promocionNombre?: string;
  }[];
  pagos: { metodoPago: string; monto: number }[];
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

export type Factura = {
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
  timbrado: {
    estado: string;
    uuid: string;
    proveedor: string;
    error?: string;
    fechaTimbrado?: string | null;
    motivoCancelacionSat?: string;
    folioSustitucion?: string;
  };
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
  const [tab, setTab] = useState<"porFacturar" | "facturas" | "global">("porFacturar");
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
  const [errorCarga, setErrorCarga] = useState("");
  const [consultaLista, setConsultaLista] = useState("");
  const solicitud = useRef(0);

  // Alta de factura
  const [ventaAFacturar, setVentaAFacturar] = useState<VentaFacturable | null>(null);
  // Detalle de la venta que se está revisando antes de facturar. Se pide al
  // abrir y no con la lista: son hasta 600 ventas y casi ninguna se abre.
  const [ventaVista, setVentaVista] = useState<VentaFacturable | null>(null);
  const [detalle, setDetalle] = useState<VentaDetalle | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
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
  // Cancelar una factura timbrada exige motivo del catálogo del SAT, y el 01
  // además el UUID de la que la sustituye.
  const [motivoSat, setMotivoSat] = useState("02");
  const [folioSustitucion, setFolioSustitucion] = useState("");
  const [timbrandoId, setTimbrandoId] = useState<string | null>(null);
  // Lo que impide timbrar, tal como lo reporta el servidor. Se revisa antes de
  // emitir porque un timbre gastado no se recupera.
  const [problemasTimbrado, setProblemasTimbrado] = useState<string[]>([]);
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
    const id = ++solicitud.current;
    if (tab === "global") return;
    const consulta = query();
    setLoading(true);
    setErrorCarga("");
    setConsultaLista("");
    const ruta = tab === "porFacturar" ? "/api/facturas/ventas" : "/api/facturas";
    try {
      const res = await fetch(`${ruta}?${consulta}`);
      if (!res.ok) throw new Error("No se pudo consultar la lista.");
      const data = await res.json();
      if (id !== solicitud.current) return;
      if (tab === "porFacturar") setVentas(data);
      else setFacturas(data);
      setConsultaLista(`${tab}?${consulta}`);
      setPage(1);
    } catch {
      if (id === solicitud.current) setErrorCarga("No se pudo consultar la lista. Actualiza para reintentar.");
    } finally {
      if (id === solicitud.current) setLoading(false);
    }
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
  /** Abre el detalle de una venta para revisarla antes de facturarla. */
  async function verVenta(venta: VentaFacturable) {
    setVentaVista(venta);
    setDetalle(null);
    setErrorDetalle(null);
    setCargandoDetalle(true);
    const res = await fetch(`/api/ventas/${venta._id}`);
    setCargandoDetalle(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorDetalle(data.error || "No se pudo cargar el detalle de la venta");
      return;
    }
    setDetalle(await res.json());
  }

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

  /**
   * Revisa y timbra. Son dos llamadas a propósito: la primera solo arma el CFDI
   * y reporta lo que falta, sin gastar timbre. Un CFDI ya timbrado no se
   * corrige, se cancela y se vuelve a emitir.
   */
  async function timbrarFactura(id: string) {
    setErrorAccion(null);
    setProblemasTimbrado([]);
    setTimbrandoId(id);

    const revision = await fetch(`/api/facturas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "revisarTimbrado" }),
    });
    const datosRevision = await revision.json().catch(() => ({}));
    if (!revision.ok || !datosRevision.listaParaTimbrar) {
      setTimbrandoId(null);
      setProblemasTimbrado(datosRevision.problemas ?? []);
      setErrorAccion(datosRevision.error || "La factura todavía no se puede timbrar");
      return;
    }

    const res = await fetch(`/api/facturas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "timbrar" }),
    });
    setTimbrandoId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setProblemasTimbrado(data.problemas ?? []);
      setErrorAccion(data.error || "No se pudo timbrar la factura");
      return;
    }

    const actualizada: Factura = await res.json();
    setFacturas((prev) => prev.map((f) => (f._id === actualizada._id ? actualizada : f)));
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
      body: JSON.stringify({
        accion: "cancelar",
        motivo: motivoCancelacion.trim(),
        ...(facturaACancelar.timbrado?.estado === "timbrada"
          ? { motivoSat, folioSustitucion: folioSustitucion.trim() }
          : {}),
      }),
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
        <Button variant={tab === "global" ? "primary" : "ghost"} onClick={() => setTab("global")}>Global del día</Button>
      </div>

      {tab === "global" ? <FacturaGlobalManager sucursales={sucursales} /> : <>
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
          <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={cargar} disabled={loading}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </span>
          </Button>
          <ExportarExcelButton disabled={loading || !!errorCarga || consultaLista !== `${tab}?${query()}` || lista.length === 0}
            crearReporte={() => {
              const filtros: [string, string][] = [["Desde", desde], ["Hasta", hasta],
                ["Sucursal", sucursales.find(s => s._id === sucursalId)?.nombre || "Todas"], ["Búsqueda", busqueda],
                ["Alcance", tab === "porFacturar" ? "Ventas pendientes dentro de las 600 ventas elegibles más recientes consultadas." : "Hasta 500 facturas consultadas, incluidas todas las páginas de la lista."],
                ["Fiscal", "Comprobantes internos. La exportación no timbra ni modifica facturas."]];
              return tab === "porFacturar" ? excelPorFacturar(ventas, zonaHoraria, filtros) : excelFacturas(facturas, zonaHoraria, filtros);
            }} />
          </div>
        </div>

        {errorCarga && <p role="alert" className="mb-3 text-sm text-red-800">{errorCarga}</p>}
        <p className="mb-3 text-sm text-black/70">El Excel incluye los registros consultados de todas las páginas. {tab === "porFacturar" ? "La consulta revisa hasta 600 ventas elegibles recientes; reduce el periodo para revisar las anteriores." : "La consulta admite hasta 500 facturas; reduce el periodo si alcanzas ese límite."}</p>

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
                    <tr
                      key={v._id}
                      onClick={() => verVenta(v)}
                      title="Ver lo que se vendió"
                      className="cursor-pointer border-b border-black/5 transition-colors hover:bg-titos-green-100/40"
                    >
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
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); abrirAlta(v); }}>
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
                        {f.timbrado?.estado === "timbrada"
                          ? "Timbrada"
                          : f.timbrado?.estado === "cancelada_sat"
                            ? "Cancelada ante el SAT"
                            : f.timbrado?.estado === "error"
                              ? "Error al timbrar"
                              : "Sin timbrar"}
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
                            <span>{etiquetaImpuestos(f)}</span>
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
                        {problemasTimbrado.length > 0 ? (
                          <ul className="list-disc space-y-1 rounded border border-amber-700 bg-amber-50 p-3 pl-7 text-sm">
                            {problemasTimbrado.map((problema, i) => (
                              <li key={i}>{problema}</li>
                            ))}
                          </ul>
                        ) : null}
                        {f.timbrado?.uuid ? (
                          <p className="rounded bg-black/3 p-3 text-sm">
                            <span className="text-black/45">Folio fiscal (UUID):</span>{" "}
                            <span className="font-mono">{f.timbrado.uuid}</span>
                          </p>
                        ) : null}

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
                          {f.timbrado?.uuid ? (
                            <a href={`/api/facturas/${f._id}/xml`} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="secondary">
                                <span className="flex items-center gap-1.5">
                                  <Download className="h-4 w-4" />
                                  Descargar XML
                                </span>
                              </Button>
                            </a>
                          ) : null}
                          {f.estado === "generada" && f.timbrado?.estado !== "timbrada" ? (
                            <Button
                              size="sm"
                              onClick={() => timbrarFactura(f._id)}
                              disabled={timbrandoId === f._id}
                            >
                              <span className="flex items-center gap-1.5">
                                <Stamp className="h-4 w-4" />
                                {timbrandoId === f._id ? "Timbrando..." : "Timbrar ante el SAT"}
                              </span>
                            </Button>
                          ) : null}
                          {f.estado === "generada" ? (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setMotivoCancelacion("");
                                setMotivoSat("02");
                                setFolioSustitucion("");
                                setErrorAccion(null);
                                setProblemasTimbrado([]);
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

      </>}
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

      {/* Detalle de la venta antes de facturar: hasta ahora se facturaba sin
          poder ver qué traía el ticket. */}
      {ventaVista ? (
        <Modal
          open
          onClose={() => setVentaVista(null)}
          title={`Venta ${ventaVista.folio}`}
          icon={ReceiptText}
          footer={
            <>
              <Button variant="ghost" onClick={() => setVentaVista(null)}>
                Cerrar
              </Button>
              <Button
                onClick={() => {
                  const venta = ventaVista;
                  setVentaVista(null);
                  abrirAlta(venta);
                }}
              >
                Facturar esta venta
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-black/55">
            {formatFechaHora(ventaVista.fecha, zonaHoraria, "—")} · {ventaVista.sucursalNombre} ·{" "}
            {ventaVista.clienteNombre || "Público en general"}
          </p>

          {cargandoDetalle ? (
            <p className="text-sm text-black/50">Cargando lo vendido...</p>
          ) : errorDetalle ? (
            <p className="text-sm text-red-600">{errorDetalle}</p>
          ) : detalle ? (
            <>
              <div className="overflow-x-auto rounded-lg border border-black/10">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 bg-black/2 text-black/50">
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-2 py-2 text-right">Cant.</th>
                      <th className="px-2 py-2 text-right">P. unitario</th>
                      <th className="px-3 py-2 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.items.map((i, n) => (
                      <tr key={`${i.sku}-${n}`} className="border-b border-black/5 last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium text-black/80">{i.nombreProducto}</span>
                          <span className="block text-xs text-black/40">SKU: {i.sku}</span>
                          {i.descuento ? (
                            <span className="block text-xs text-titos-orange-700">
                              {i.promocionNombre || "Promoción"}: −{formatMoney(i.descuento)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-right text-black/60">
                          {i.cantidad} {i.unidad}
                        </td>
                        <td className="px-2 py-2 text-right text-black/60">{formatMoney(i.precioUnitario)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-titos-green-900">
                          {formatMoney(i.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 space-y-1 text-sm">
                {/* Solo las ventas cobradas con impuestos traen desglose. */}
                {(detalle.totalIva ?? 0) > 0 || (detalle.totalIeps ?? 0) > 0 ? (
                  <>
                    <div className="flex justify-between text-black/55">
                      <span>Subtotal</span>
                      <span>{formatMoney(detalle.baseGravable ?? 0)}</span>
                    </div>
                    {(detalle.totalIeps ?? 0) > 0 ? (
                      <div className="flex justify-between text-black/55">
                        <span>IEPS</span>
                        <span>{formatMoney(detalle.totalIeps ?? 0)}</span>
                      </div>
                    ) : null}
                    {(detalle.totalIva ?? 0) > 0 ? (
                      <div className="flex justify-between text-black/55">
                        <span>IVA</span>
                        <span>{formatMoney(detalle.totalIva ?? 0)}</span>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="flex justify-between border-t border-black/10 pt-1 font-semibold text-titos-green-900">
                  <span>Total</span>
                  <span>{formatMoney(detalle.total)}</span>
                </div>
              </div>

              {detalle.pagos?.length ? (
                <p className="mt-3 text-xs text-black/50">
                  Se pagó con:{" "}
                  {detalle.pagos.map((p) => `${p.metodoPago} ${formatMoney(p.monto)}`).join(" · ")}
                </p>
              ) : null}
            </>
          ) : null}
        </Modal>
      ) : null}

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

          {facturaACancelar.timbrado?.estado === "timbrada" ? (
            <div className="mb-3 space-y-3 rounded border border-amber-700 bg-amber-50 p-3">
              <p className="text-sm">
                Esta factura está timbrada ante el SAT (UUID{" "}
                <span className="font-mono">{facturaACancelar.timbrado.uuid}</span>). Se cancela primero allá y
                solo si el SAT la acepta se marca cancelada aquí. Fuera del mes en curso, la cancelación requiere
                que el receptor la acepte.
              </p>
              <label className="block text-sm">
                Motivo de cancelación del SAT
                <select
                  className="mt-1 block w-full rounded border border-black/20 p-2"
                  value={motivoSat}
                  onChange={(e) => setMotivoSat(e.target.value)}
                >
                  {MOTIVOS_CANCELACION.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              {motivoSat === "01" ? (
                <label className="block text-sm">
                  UUID de la factura que sustituye a esta
                  <Input
                    value={folioSustitucion}
                    onChange={(e) => setFolioSustitucion(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
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
