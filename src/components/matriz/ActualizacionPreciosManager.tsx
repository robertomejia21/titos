"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, FileDown, PencilLine, Upload, RefreshCw, Download } from "lucide-react";
import { Button, Card, Input, FormField, EmptyState, Pagination, formatMoney } from "@/components/ui";
import { usePaginacion } from "@/components/usePaginacion";
import { ProductoCombobox } from "@/components/ProductoCombobox";
import { ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

type Producto = {
  _id: string;
  sku: string;
  nombre: string;
  alias?: string[];
  precioVenta: number;
  unidad: string;
};

type FilaImportada = { codigo: string; precio: number };

type ResultadoImportacion = {
  actualizados: number;
  noEncontrados: string[];
  invalidos: string[];
  sinCambio: string[];
};

type CambioPrecio = {
  _id: string;
  sku: string;
  nombre: string;
  categoria: string;
  unidad: string;
  precioAnterior: number;
  precioNuevo: number;
  origen: "excel" | "manual";
  fecha: string;
};

function aInputLocal(fecha: Date) {
  const offset = fecha.getTimezoneOffset() * 60000;
  return new Date(fecha.getTime() - offset).toISOString().slice(0, 16);
}

function detectarColumnas(encabezados: string[]) {
  const normalizados = encabezados.map((h) => h.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""));
  const colCodigo = encabezados[normalizados.findIndex((h) => h.includes("codigo") || h.includes("sku"))];
  const conNuevo = normalizados.findIndex((h) => h.includes("precio") && h.includes("nuevo"));
  const soloPrecio = normalizados.findIndex((h) => h.includes("precio"));
  const colPrecio = encabezados[conNuevo >= 0 ? conNuevo : soloPrecio];
  return { colCodigo, colPrecio };
}

export function ActualizacionPreciosManager() {
  // --- Importación desde Excel ---
  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaImportada[]>([]);
  const [filasOmitidas, setFilasOmitidas] = useState(0);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Actualización manual ---
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoId, setProductoId] = useState("");
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [mensajeManual, setMensajeManual] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // --- Exportación por periodo ---
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [cambios, setCambios] = useState<CambioPrecio[]>([]);
  const [cargandoCambios, setCargandoCambios] = useState(false);

  const cargarProductos = useCallback(async () => {
    const res = await fetch("/api/productos");
    if (res.ok) setProductos(await res.json());
  }, []);

  const consultarCambios = useCallback(async (desdeLocal: string, hastaLocal: string) => {
    if (!desdeLocal || !hastaLocal) return;
    setCargandoCambios(true);
    const params = new URLSearchParams({
      desde: new Date(desdeLocal).toISOString(),
      hasta: new Date(hastaLocal).toISOString(),
    });
    const res = await fetch(`/api/actualizacion-precios?${params.toString()}`);
    if (res.ok) setCambios(await res.json());
    setCargandoCambios(false);
  }, []);

  useEffect(() => {
    cargarProductos();
    // Periodo por default: la última hora
    const ahora = new Date();
    const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
    const d = aInputLocal(haceUnaHora);
    const h = aInputLocal(ahora);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inicializa el periodo con la hora local del navegador
    setDesde(d);
    setHasta(h);
    consultarCambios(d, h);
  }, [cargarProductos, consultarCambios]);

  function descargarPlantilla() {
    const filasPlantilla = productos.map((p) => ({
      Código: p.sku,
      Producto: p.nombre,
      "Precio actual": p.precioVenta,
      "Nuevo Precio": "",
    }));
    const hoja = XLSX.utils.json_to_sheet(filasPlantilla);
    hoja["!cols"] = [{ wch: 14 }, { wch: 42 }, { wch: 12 }, { wch: 12 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Precios");
    XLSX.writeFile(libro, "plantilla-actualizacion-precios.xlsx");
  }

  async function leerArchivo(file: File) {
    setErrorArchivo(null);
    setResultado(null);
    setFilas([]);
    setFilasOmitidas(0);
    setArchivoNombre(file.name);

    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const registros = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: "" });

      if (registros.length === 0) {
        setErrorArchivo("El archivo está vacío.");
        return;
      }

      const { colCodigo, colPrecio } = detectarColumnas(Object.keys(registros[0]));
      if (!colCodigo || !colPrecio) {
        setErrorArchivo(
          'No se encontraron las columnas esperadas. El archivo debe tener una columna "Código" (o "SKU") y una columna "Nuevo Precio".'
        );
        return;
      }

      const filasLeidas: FilaImportada[] = [];
      let omitidas = 0;
      for (const registro of registros) {
        const codigo = String(registro[colCodigo] ?? "").trim();
        if (!codigo) continue;
        const precioTexto = String(registro[colPrecio] ?? "").trim();
        // Filas de la plantilla sin nuevo precio capturado: se ignoran
        if (!precioTexto) {
          omitidas++;
          continue;
        }
        filasLeidas.push({ codigo, precio: Number(precioTexto.replace(/[$,\s]/g, "")) });
      }

      if (filasLeidas.length === 0) {
        setErrorArchivo(
          omitidas > 0
            ? "Ninguna fila tiene capturado un nuevo precio. Llena la columna \"Nuevo Precio\" de los productos que cambien."
            : "No se encontraron filas con código de producto."
        );
        return;
      }
      setFilas(filasLeidas);
      setFilasOmitidas(omitidas);
    } catch {
      setErrorArchivo("No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.");
    }
  }

  async function aplicarImportacion() {
    setImportando(true);
    setErrorArchivo(null);

    const res = await fetch("/api/actualizacion-precios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origen: "excel", items: filas.map((f) => ({ codigo: f.codigo, precio: f.precio })) }),
    });

    setImportando(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorArchivo(data.error || "No se pudo aplicar la actualización");
      return;
    }

    setResultado(await res.json());
    setFilas([]);
    setFilasOmitidas(0);
    setArchivoNombre(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    cargarProductos();
    consultarCambios(desde, hasta);
  }

  const productoSeleccionado = productos.find((p) => p._id === productoId) ?? null;

  async function actualizarManual() {
    if (!productoSeleccionado) return;
    setMensajeManual(null);
    setGuardandoManual(true);

    const res = await fetch("/api/actualizacion-precios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origen: "manual", items: [{ productoId: productoSeleccionado._id, precio: Number(nuevoPrecio) }] }),
    });

    setGuardandoManual(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMensajeManual({ tipo: "error", texto: data.error || "No se pudo actualizar el precio" });
      return;
    }

    const data: ResultadoImportacion = await res.json();
    if (data.sinCambio.length > 0) {
      setMensajeManual({ tipo: "error", texto: "El producto ya tiene ese precio; no se registró ningún cambio." });
    } else if (data.invalidos.length > 0) {
      setMensajeManual({ tipo: "error", texto: "Captura un precio válido mayor a cero." });
    } else {
      setMensajeManual({
        tipo: "ok",
        texto: `Precio de ${productoSeleccionado.nombre} actualizado de ${formatMoney(productoSeleccionado.precioVenta)} a ${formatMoney(Number(nuevoPrecio))}.`,
      });
      setProductoId("");
      setNuevoPrecio("");
      cargarProductos();
      consultarCambios(desde, hasta);
    }
  }

  // Cada consulta trae un arreglo nuevo: al cambiar regresa a la página 1.
  const { pagina: paginaCambios, paginacion: paginacionCambios } = usePaginacion(cambios, cambios);

  function descargarPdf() {
    const params = new URLSearchParams({
      desde: new Date(desde).toISOString(),
      hasta: new Date(hasta).toISOString(),
    });
    window.open(`/api/actualizacion-precios/pdf?${params.toString()}`, "_blank");
  }

  return (
    <div className="space-y-6">
      {/* Importar desde Excel */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-titos-green-700" />
          <h2 className="font-semibold text-titos-green-900">Importar desde Excel</h2>
        </div>
        <p className="mb-4 text-sm text-black/50">
          Descarga la plantilla con todo el catálogo, captura la columna{" "}
          <span className="font-medium">Nuevo Precio</span> solo en los productos que cambien y vuelve a subirla aquí.
          También acepta cualquier .xlsx o .csv que tenga una columna <span className="font-medium">Código</span> y una
          columna <span className="font-medium">Nuevo Precio</span>.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={descargarPlantilla} disabled={productos.length === 0}>
            <span className="flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Descargar plantilla
            </span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) leerArchivo(file);
            }}
            className="text-sm text-black/60 file:mr-3 file:rounded-lg file:border-0 file:bg-titos-green-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-titos-green-700 hover:file:bg-titos-green-100/70"
          />
          {filas.length > 0 ? (
            <Button onClick={aplicarImportacion} disabled={importando}>
              <span className="flex items-center gap-1.5">
                <Upload className="h-4 w-4" />
                {importando ? "Actualizando..." : `Aplicar actualización (${filas.length} productos)`}
              </span>
            </Button>
          ) : null}
        </div>

        {errorArchivo ? <p className="mt-3 text-sm text-red-600">{errorArchivo}</p> : null}

        {filas.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-black/40">
              Vista previa de {archivoNombre} — revisa antes de aplicar:
              {filasOmitidas > 0 ? ` (${filasOmitidas} filas sin nuevo precio se omitieron)` : ""}
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-black/10">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-titos-green-100">
                  <tr className="text-titos-green-900">
                    <th className="px-2 py-1.5 text-xs font-medium">Código</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Nuevo precio</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr key={idx} className="border-b border-black/5">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{f.codigo}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right ${!Number.isFinite(f.precio) || f.precio <= 0 ? "text-red-600" : ""}`}>
                        {Number.isFinite(f.precio) && f.precio > 0 ? formatMoney(f.precio) : "precio inválido"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {resultado ? (
          <div className="mt-4 space-y-1 rounded-xl bg-titos-green-100 p-4 text-sm text-titos-green-900">
            <p className="font-semibold">Se actualizaron {resultado.actualizados} precios.</p>
            {resultado.sinCambio.length > 0 ? (
              <p>{resultado.sinCambio.length} productos ya tenían ese precio: {resultado.sinCambio.join(", ")}</p>
            ) : null}
            {resultado.noEncontrados.length > 0 ? (
              <p className="text-red-700">Códigos no encontrados: {resultado.noEncontrados.join(", ")}</p>
            ) : null}
            {resultado.invalidos.length > 0 ? (
              <p className="text-red-700">Con precio inválido: {resultado.invalidos.join(", ")}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Actualización manual */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <PencilLine className="h-5 w-5 text-titos-green-700" />
          <h2 className="font-semibold text-titos-green-900">Actualizar un producto</h2>
        </div>
        <p className="mb-4 text-sm text-black/50">Busca el producto por su código o nombre y captura el nuevo precio.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <FormField label="Producto">
            <ProductoCombobox
              productos={productos}
              value={productoId}
              onChange={(id) => {
                setProductoId(id);
                setMensajeManual(null);
              }}
              placeholder="Buscar por código o nombre..."
            />
          </FormField>
          <FormField label={productoSeleccionado ? `Nuevo precio (actual: ${formatMoney(productoSeleccionado.precioVenta)})` : "Nuevo precio"}>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={nuevoPrecio}
              onChange={(e) => setNuevoPrecio(e.target.value)}
              placeholder="0.00"
              className="sm:w-48"
              onKeyDown={(e) => {
                if (e.key === "Enter" && productoSeleccionado && Number(nuevoPrecio) > 0) actualizarManual();
              }}
            />
          </FormField>
          <Button
            onClick={actualizarManual}
            disabled={guardandoManual || !productoSeleccionado || !(Number(nuevoPrecio) > 0)}
            className="sm:mb-0.5"
          >
            {guardandoManual ? "Guardando..." : "Actualizar precio"}
          </Button>
        </div>

        {mensajeManual ? (
          <p className={`mt-3 text-sm font-medium ${mensajeManual.tipo === "ok" ? "text-titos-green-700" : "text-red-600"}`}>
            {mensajeManual.texto}
          </p>
        ) : null}
      </Card>

      {/* Exportar precios actualizados */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <FileDown className="h-5 w-5 text-titos-green-700" />
          <h2 className="font-semibold text-titos-green-900">Exportar precios actualizados</h2>
        </div>
        <p className="mb-4 text-sm text-black/50">
          Elige el periodo de los cambios (por default la última hora) y descarga el PDF para enviarlo a las sucursales.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Desde">
            <Input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </FormField>
          <FormField label="Hasta">
            <Input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </FormField>
          <Button variant="ghost" onClick={() => consultarCambios(desde, hasta)} disabled={cargandoCambios || !desde || !hasta}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className={`h-4 w-4 ${cargandoCambios ? "animate-spin" : ""}`} /> Consultar
            </span>
          </Button>
          <Button onClick={descargarPdf} disabled={cambios.length === 0 || !desde || !hasta}>
            <span className="flex items-center gap-1.5">
              <FileDown className="h-4 w-4" /> Descargar PDF ({cambios.length})
            </span>
          </Button>
        </div>

        <div className="mt-4">
          {cargandoCambios ? (
            <p className="py-6 text-center text-sm text-black/50">Consultando cambios...</p>
          ) : cambios.length === 0 ? (
            <EmptyState message="No hay precios actualizados en el periodo seleccionado." />
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-black/50">
                    <th className="px-2 py-1.5 text-xs font-medium">Código</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Producto</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Categoría</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Precio anterior</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Precio nuevo</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Origen</th>
                    <th className="px-2 py-1.5 text-xs font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaCambios.map((c) => (
                    <tr key={c._id} className="border-b border-black/5">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{c.sku}</td>
                      <td className="max-w-[16rem] truncate px-2 py-1.5 font-medium" title={c.nombre}>{c.nombre}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 capitalize text-black/60">{c.categoria.replaceAll("_", " ")}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-black/50 line-through">{formatMoney(c.precioAnterior)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-titos-green-700">{formatMoney(c.precioNuevo)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/50">{c.origen === "excel" ? "Excel" : "Manual"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-black/50">
                        {new Intl.DateTimeFormat("es-MX", {
                          timeZone: ZONA_HORARIA_DEFAULT,
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(c.fecha))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paginacionCambios} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
