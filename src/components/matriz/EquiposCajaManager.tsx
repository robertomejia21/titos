"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button, Card, FormField, FormGrid, Input, Select } from "@/components/ui";
import { BAUDIOS, EQUIPO_VACIO, PRUEBAS_EQUIPO, pesoEnKg, type EquipoCajaConfig } from "@/lib/equiposCaja";
import { leerPuertoDiagnostico, type SerialApi } from "@/lib/serialDiagnostico";

type Datos = {
  sucursalId: string; sucursales: { _id: string; nombre: string }[];
  terminales: { _id: string; alias: string; banco: string }[];
  equipo: { configuracion: EquipoCajaConfig; actualizadoPor: string; updatedAt: string } | null;
  puedeEditar: boolean;
};
const campo = "w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm";

function TarjetaEquipo({ titulo, abierta = false, children }: { titulo: string; abierta?: boolean; children: ReactNode }) {
  return <Card className="p-0!">
    <details open={abierta} className="group/tarjeta">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 text-titos-green-900 hover:bg-titos-green-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titos-green-700 sm:p-5 [&::-webkit-details-marker]:hidden">
        <h2 className="min-w-0 text-base font-semibold sm:text-lg">{titulo}</h2>
        <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 group-open/tarjeta:rotate-180" />
      </summary>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </details>
  </Card>;
}

export function EquiposCajaManager() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [sucursal, setSucursal] = useState("");
  const [form, setForm] = useState<EquipoCajaConfig>(EQUIPO_VACIO);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [codigo, setCodigo] = useState("");
  const [peso, setPeso] = useState("");
  const [unidad, setUnidad] = useState<"kg" | "g">("kg");
  const [precio, setPrecio] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [serialTexto, setSerialTexto] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(datos?.equipo?.configuracion ?? EQUIPO_VACIO);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/equipos-caja${sucursal ? `?sucursalId=${encodeURIComponent(sucursal)}` : ""}`, { signal: abort.signal })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo cargar la configuración"); return d as Datos; })
      .then(d => { setDatos(d); setForm(d.equipo?.configuracion ?? EQUIPO_VACIO); setError(""); setAviso(""); setConfirmado(false); })
      .catch(e => { if (!abort.signal.aborted) { setDatos(null); setError(e.message); } })
      .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => { abort.abort(); abortRef.current?.abort(); };
  }, [sucursal]);

  const set = <K extends keyof EquipoCajaConfig>(key: K, value: EquipoCajaConfig[K]) => {
    setForm(f => ({ ...f, [key]: value })); setAviso(""); setConfirmado(false);
  };
  async function guardar() {
    if (!datos) return;
    setGuardando(true); setError(""); setAviso("");
    try {
      const r = await fetch("/api/equipos-caja", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sucursalId: datos.sucursalId, configuracion: form }) });
      const equipo = await r.json(); if (!r.ok) throw new Error(equipo.error || "No se pudo guardar");
      setDatos({ ...datos, equipo }); setForm(equipo.configuracion); setAviso("Configuración guardada. Esto no activa una conexión automática.");
    } catch (e) { setError((e as Error).message); } finally { setGuardando(false); }
  }
  async function diagnosticar() {
    const serial = (navigator as Navigator & { serial?: SerialApi }).serial;
    if (!serial) { setSerialTexto("Este navegador no ofrece puertos seriales. Abre esta pantalla en Chrome o Edge de la computadora de caja."); return; }
    if (!confirmado || !form.baudRate || abortRef.current) return;
    const abort = new AbortController(); abortRef.current = abort;
    setLeyendo(true); setSerialTexto("Selecciona el puerto de la báscula. Se escuchará durante 8 segundos.");
    try {
      const bytes = await leerPuertoDiagnostico(serial, form, abort.signal);
      if (!abort.signal.aborted) setSerialTexto(bytes.length
        ? `Datos recibidos (${bytes.length} bytes). Aún no se interpretan como peso.\nHEX: ${bytes.map(b => b.toString(16).padStart(2, "0")).join(" ")}\nTexto: ${bytes.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : `[${b.toString(16).padStart(2, "0")}]`).join("")}`
        : "No llegaron datos. Esto no prueba que la báscula esté dañada: puede requerir un comando o el controlador OPOS. Revisa puerto, cable y protocolo con el técnico.");
    } catch (e) { if (!abort.signal.aborted) setSerialTexto(`No se completó la lectura: ${(e as Error).message}. Cierra BRANIX o DualTest si tienen ocupado el puerto.`); }
    finally { abortRef.current = null; setLeyendo(false); }
  }
  const kg = pesoEnKg(peso, unidad);
  const precioNum = /^\d+(?:[.,]\d{1,2})?$/.test(precio) ? Number(precio.replace(",", ".")) : NaN;
  const importe = kg && Number.isFinite(precioNum) && precioNum >= 0 && precioNum <= 1000000 ? Math.round(kg * precioNum * 100) / 100 : null;
  return <div className="space-y-5">
    <TarjetaEquipo titulo="Preparación de la caja" abierta>
      <p className="mt-2 text-sm text-black/70">Hoy puedes capturar el peso del visor y registrar un pago aprobado en la terminal. La lectura automática de la báscula y el envío del importe a Banorte requieren identificar y probar los equipos en la tienda.</p>
      {cargando ? <p className="mt-3" role="status">Cargando sucursal…</p> : datos && <div className="mt-4 max-w-lg">
        <FormField label="Sucursal"><Select aria-label="Sucursal de los equipos" disabled={guardando || leyendo || datos.sucursales.length < 2} value={datos.sucursalId} onChange={e => {
          if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cambiar de sucursal y descartarlos?")) return;
          setCargando(true); setSucursal(e.target.value);
        }}>{datos.sucursales.map(s => <option key={s._id} value={s._id}>{s.nombre}</option>)}</Select></FormField>
        <p className="mt-2 text-xs text-black/65">Se guarda una configuración de referencia por sucursal. El permiso para abrir un puerto se elige en cada computadora.</p>
      </div>}
    </TarjetaEquipo>
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
    {datos && !cargando && <>
      <TarjetaEquipo titulo="1. Identificar los equipos">
        {!datos.puedeEditar && <p className="mb-3 text-sm">Solo administración puede guardar esta configuración. Puedes consultar la guía y hacer pruebas locales.</p>}
        <fieldset disabled={!datos.puedeEditar || guardando || leyendo} className="space-y-4">
          <FormGrid><FormField label="Nombre de caja"><Input aria-label="Nombre de caja" maxLength={60} value={form.nombreCaja} onChange={e => set("nombreCaja", e.target.value)} placeholder="Ej. Caja principal" /></FormField>
          <FormField label="Computadora"><Select aria-label="Computadora" value={form.sistemaOperativo} onChange={e => set("sistemaOperativo", e.target.value)}><option value="por_confirmar">Por confirmar</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option></Select></FormField></FormGrid>
          <FormGrid><FormField label="Marca de báscula"><Input aria-label="Marca de báscula" value={form.marcaBascula} maxLength={60} onChange={e => set("marcaBascula", e.target.value)} placeholder="Ej. PSC / Datalogic" /></FormField>
          <FormField label="Modelo exacto de báscula"><Input aria-label="Modelo exacto de báscula" value={form.modeloBascula} maxLength={100} onChange={e => set("modeloBascula", e.target.value)} placeholder="Copiar de la placa del equipo" /></FormField></FormGrid>
          <FormGrid><FormField label="Conexión confirmada por el técnico"><Select aria-label="Conexión confirmada por el técnico" value={form.conexionBascula} onChange={e => set("conexionBascula", e.target.value)}><option value="por_confirmar">Por confirmar</option><option value="rs232">RS-232</option><option value="usb_serial">USB que crea un puerto COM</option><option value="opos">Controlador OPOS en Windows</option></Select></FormField>
          <FormField label="Puerto identificado"><Input aria-label="Puerto identificado" maxLength={40} value={form.puerto} onChange={e => set("puerto", e.target.value)} placeholder="Ej. COM3; no confundir con un puerto de red" /></FormField></FormGrid>
          <FormGrid><FormField label="Terminal bancaria registrada"><Select aria-label="Terminal bancaria registrada" value={form.terminalId} onChange={e => set("terminalId", e.target.value)}><option value="">Seleccionar terminal</option>{datos.terminales.map(t => <option key={t._id} value={t._id}>{t.alias} · {t.banco}</option>)}</Select></FormField>
          <FormField label="Modelo de terminal bancaria"><Input aria-label="Modelo de terminal bancaria" value={form.modeloTerminal} maxLength={100} onChange={e => set("modeloTerminal", e.target.value)} placeholder="Copiar de la etiqueta de la terminal" /></FormField></FormGrid>
          <FormField label="Gestión con Banorte (no habilita cobros automáticos)"><Select aria-label="Gestión con Banorte (no habilita cobros automáticos)" value={form.banorteIntegracion} onChange={e => set("banorteIntegracion", e.target.value)}><option value="sin_solicitar">Falta solicitar integración con caja</option><option value="solicitada">Solicitada a Banorte</option><option value="documentacion_recibida">Documentación recibida; falta integración y pruebas</option></Select></FormField>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={form.exigirAutorizacion} onChange={e => set("exigirAutorizacion", e.target.checked)} />Exigir folio o autorización del comprobante al registrar pagos con tarjeta en esta sucursal</label>
          <FormField label="Notas del técnico (sin contraseñas ni datos de tarjetas)"><textarea aria-label="Notas del técnico (sin contraseñas ni datos de tarjetas)" className={campo} rows={3} maxLength={1200} value={form.notas} onChange={e => set("notas", e.target.value)} /></FormField>
          <details><summary className="cursor-pointer py-3 font-medium">Parámetros seriales · solo para el técnico</summary><p className="mb-3 text-sm">Copia los parámetros de la configuración existente o del manual del modelo. Las opciones iniciales no confirman la configuración del equipo.</p>
            <FormGrid><FormField label="Velocidad"><Select aria-label="Velocidad" value={form.baudRate} onChange={e => set("baudRate", Number(e.target.value))}><option value={0}>Por confirmar</option>{BAUDIOS.map(b => <option key={b} value={b}>{b}</option>)}</Select></FormField><FormField label="Bits de datos"><Select aria-label="Bits de datos" value={form.dataBits} onChange={e => set("dataBits", Number(e.target.value) as 7 | 8)}><option value={7}>7</option><option value={8}>8</option></Select></FormField>
            <FormField label="Paridad"><Select aria-label="Paridad" value={form.parity} onChange={e => set("parity", e.target.value as EquipoCajaConfig["parity"])}><option value="none">Ninguna</option><option value="even">Par</option><option value="odd">Impar</option></Select></FormField><FormField label="Bits de parada"><Select aria-label="Bits de parada" value={form.stopBits} onChange={e => set("stopBits", Number(e.target.value) as 1 | 2)}><option value={1}>1</option><option value={2}>2</option></Select></FormField>
            <FormField label="Control de flujo"><Select aria-label="Control de flujo" value={form.flowControl} onChange={e => set("flowControl", e.target.value as EquipoCajaConfig["flowControl"])}><option value="none">Ninguno</option><option value="hardware">Hardware</option></Select></FormField></FormGrid>
          </details>
          <p className="font-medium">Verificaciones declaradas por el técnico</p><p className="text-sm">Marcar estos puntos registra una revisión; no certifica la conexión con Titos.</p>
          {(Object.entries(PRUEBAS_EQUIPO) as [keyof typeof PRUEBAS_EQUIPO, string][]).map(([k, label]) => <label key={k} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={form.pruebas[k]} onChange={e => set("pruebas", { ...form.pruebas, [k]: e.target.checked })} />{label}</label>)}
        </fieldset>
        {datos.puedeEditar && <div className="mt-4 flex flex-wrap items-center gap-3"><Button onClick={guardar} disabled={guardando || leyendo || !dirty}>{guardando ? "Guardando…" : "Guardar configuración"}</Button><Link className="text-sm underline" href="/matriz/terminales">Registrar una terminal bancaria</Link></div>}
        {aviso && <p role="status" className="mt-3 text-sm text-titos-green-900">{aviso}</p>}
        {datos.equipo && <p className="mt-3 text-xs text-black/65">Última configuración: {datos.equipo.actualizadoPor} · {new Date(datos.equipo.updatedAt).toLocaleString("es-MX")}</p>}
      </TarjetaEquipo>
      <TarjetaEquipo titulo="2. Probar lector y peso"><p className="mb-4 text-sm">Estas pruebas no crean ventas ni cobran dinero.</p>
        <FormField label="Prueba del lector"><Input aria-label="Prueba del lector" value={codigo} maxLength={80} onChange={e => setCodigo(e.target.value)} placeholder="Haz clic aquí y escanea un producto" /></FormField>
        {codigo && <p className="mt-2 break-all text-sm" role="status">Código recibido: {codigo} · {codigo.length} caracteres. Compáralo con la etiqueta. Esto no confirma lectura de peso.</p>}
        <h3 className="mb-3 mt-6 font-semibold">Comprobar el cálculo por kilogramo</h3>
        <p className="mb-3 text-sm">Coloca el producto, espera que se estabilice y copia el peso neto del visor. No restes la tara dos veces. Esta prueba no aplica promociones ni cambia impuestos.</p>
        <FormGrid><FormField label="Peso del visor"><Input aria-label="Peso del visor" value={peso} inputMode="decimal" onChange={e => setPeso(e.target.value)} /></FormField><FormField label="Unidad del visor"><Select aria-label="Unidad del visor" value={unidad} onChange={e => setUnidad(e.target.value as "kg" | "g")}><option value="kg">Kilogramos</option><option value="g">Gramos</option></Select></FormField><FormField label="Precio por kilogramo"><Input aria-label="Precio por kilogramo" value={precio} inputMode="decimal" onChange={e => setPrecio(e.target.value)} /></FormField></FormGrid>
        <p role="status" className="mt-3 font-medium">{importe !== null ? `${kg!.toFixed(3)} kg × $${precioNum.toFixed(2)} = $${importe.toFixed(2)} MXN` : "Captura un peso positivo (hasta 3 decimales en kg) y el precio para comparar."}</p>
        <details className="mt-5"><summary className="min-h-11 cursor-pointer py-3 font-medium">Diagnóstico del puerto de báscula</summary>
          <p className="mb-3 text-sm">Solo recibe datos durante 8 segundos. No envía comandos ni agrega peso al carrito. Si usas OPOS, prueba primero con DualTest del fabricante. No selecciones la terminal bancaria.</p>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={confirmado} disabled={leyendo} onChange={e => setConfirmado(e.target.checked)} />El técnico confirmó velocidad, bits, paridad, control de flujo y el puerto de la báscula</label>
          <Button onClick={diagnosticar} disabled={!confirmado || !form.baudRate || leyendo || !["rs232", "usb_serial"].includes(form.conexionBascula)}>{leyendo ? "Escuchando puerto…" : "Elegir puerto y recibir datos"}</Button>
          {!form.baudRate && <p className="mt-2 text-sm">Falta confirmar la velocidad en los parámetros de la configuración.</p>}
          {serialTexto && <pre role="status" className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/5 p-3 text-xs">{serialTexto}</pre>}
        </details>
      </TarjetaEquipo>
      <TarjetaEquipo titulo="3. Instalación en Junior · guía para el técnico">
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>Anota modelo y serie de la báscula, modelo de terminal Banorte y versión de Windows. Conserva la configuración que usaban con BRANIX antes de cambiar cables o parámetros.</li>
          <li>En la foto PSC se distinguen POS Terminal, Scale Host y Remote Display. No se identifica el modelo exacto. Un conector parecido a red no asegura que sea Ethernet: el técnico debe confirmar cable y distribución de pines con el manual.</li>
          <li>Identifica la interfaz del lector y de la báscula. Pueden usar cables separados o compartir uno; depende del modelo y configuración. No conectes la computadora al puerto del visor ni alteres sellos o calibración.</li>
          <li>Si usa un puerto serial, instala el controlador oficial del adaptador compatible, identifica su COM en Windows y registra los parámetros. Si usa OPOS, instala los componentes oficiales compatibles de Datalogic y prueba Open, Claim, Enable y Read Weight con DualTest.</li>
          <li>Compara cero, peso neto estable y varios pesos conocidos entre visor y diagnóstico del fabricante. Comprueba kg frente a libras, tara, retiro del producto y desconexión. La lectura automática en Titos sigue pendiente de adaptar el protocolo de este equipo.</li>
          <li>En Productos, configura el artículo con unidad kg y su precio por kilogramo. En Punto de venta, captura el peso neto del visor y compara el subtotal antes de cobrar. Una etiqueta de carnicería requiere conocer por separado su formato; esta pantalla no decodifica peso de etiquetas.</li>
          <li>Registra la terminal Banorte en Catálogos → Terminales de pago, asignada a Junior. Comprueba su estado con Banorte; guardarla en Titos no la conecta al banco.</li>
          <li>Para operar con terminal independiente: captura en Banorte el importe final que muestra Titos, espera APROBADO y conserva el comprobante. Después registra el pago con tarjeta, terminal y autorización en Titos. Si Banorte rechaza o no confirma, consulta el estado con el banco antes de reintentar; no registres el pago como aprobado.</li>
          <li>Al cerrar, compara el total de tarjeta de Titos por terminal con el lote de Banorte y revisa diferencias con los comprobantes. Una cancelación en Titos no cancela automáticamente el cargo bancario.</li>
          <li>Para automatizar importes, solicita a Banorte integración con caja/Interredes, compatibilidad del modelo, documentación y ambiente de pruebas. Faltará implementar y certificar aprobación, rechazo, consulta de estado, cancelación y prevención de cobros duplicados.</li>
        </ol>
        <details className="mt-5"><summary className="cursor-pointer py-3 font-medium">Texto para solicitar la integración a Banorte</summary><p className="rounded-lg bg-black/5 p-3 text-sm">Tenemos el punto de venta web de Mercados Titos en sucursal Junior, Mexicali. Queremos enviar el importe a su terminal y recibir la autorización automáticamente. ¿Nuestra afiliación y modelo admiten integración con caja o Interredes? Necesitamos requisitos, documentación o SDK, ambiente de pruebas, consulta de transacciones y cancelaciones, además del proceso para habilitarlo en producción.</p></details>
        <p className="mt-4 text-xs text-black/65">Referencias técnicas: <a className="underline" href="https://www.datalogic.com/upload/marketlit/manuals/opos/820025614.pdf" target="_blank" rel="noreferrer">Datalogic OPOS / DualTest</a> · <a className="underline" href="https://www.banorte.com/Empresas/Servicios/Soluciones-de-cobro-para-tu-negocio/Productos/Terminales-punto-de-venta--TPV-/" target="_blank" rel="noreferrer">Terminales Banorte</a> · <a className="underline" href="https://developer.chrome.com/docs/capabilities/serial" target="_blank" rel="noreferrer">Web Serial</a>. Verificadas el 22 de septiembre de 2026; confirmar compatibilidad del equipo antes de instalar.</p>
      </TarjetaEquipo>
    </>}
  </div>;
}
