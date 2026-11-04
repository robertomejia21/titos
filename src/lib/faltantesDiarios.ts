import OrdenCompra from "@/models/OrdenCompra";
import Proveedor from "@/models/Proveedor";
import Producto from "@/models/Producto";
import NecesidadCompra from "@/models/NecesidadCompra";
import EnvioFaltantes from "@/models/EnvioFaltantes";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { obtenerConfiguracionOperacion, zonaCedis } from "@/lib/operacion";
import { sendMessage } from "@/lib/greenApi";
import { MOTIVO_RECHAZO_LABEL, type MotivoRechazo } from "@/lib/motivosRechazo";
import { fechaEnZona, finDelDiaEnZona, horaEnZona, inicioDelDiaEnZona } from "@/lib/zonasHorarias";
import { minimoVigente, enPresentacion } from "@/lib/minimos";
import { rotacionPerecederos } from "@/lib/rotacion";
import { ESTADO_ROTACION_LABEL } from "@/lib/perecederos";

// Lista diaria de faltantes. Reemplaza el mensaje que Fausto armaba a mano:
//  - a cada proveedor, lo que llegó contra lo que se le pidió ese día
//    ("tomate: 10 cajas recibidas vs 20 pedidas") y lo que se le regresó;
//  - a Compras y al almacén, todo junto más lo que quedó bajo mínimo y los
//    perecederos que tienen que salir primero.

const fmt = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });
const LIMITE_RENGLONES = 40;

export type RenglonProveedor = {
  folio: string;
  producto: string;
  categoria: string;
  ordenado: number;
  recibido: number;
  rechazado: number;
  motivo: string;
};

export type FaltantesDelDia = {
  fecha: string;
  porProveedor: { proveedorId: string; nombre: string; whatsapp: string; renglones: RenglonProveedor[]; mensaje: string }[];
  bajoMinimo: { nombre: string; categoria: string; existencia: string; minimo: string }[];
  necesidadesPendientes: number;
  perecederos: { nombre: string; categoria: string; estado: string; recomendacion: string }[];
  resumenInterno: string;
  /** Lista de cada grupo configurado (solo sus categorías) y la de lo que no cae en ninguno. */
  segmentos: { nombre: string; destinatarios: string[]; mensaje: string; renglones: number }[];
  /** Lo que reciben Compras y el almacén: el resto si hay grupos, o la lista completa. */
  resumenGeneral: string;
};

type Segmento = { nombre: string; categorias?: string[] | null; destinatarios?: string[] | null };

/** Las categorías se comparan sin mayúsculas ni guiones bajos ("Frutas_verduras" = "frutas verduras"). */
const normalizar = (c: string) => c.toLowerCase().replaceAll("_", " ").trim();

function resumenFiltrado(
  datos: Pick<FaltantesDelDia, "fecha" | "porProveedor" | "bajoMinimo" | "perecederos" | "necesidadesPendientes">,
  incluye: (categoria: string) => boolean,
  titulo: string
) {
  const proveedores = datos.porProveedor
    .map((p) => ({ ...p, renglones: p.renglones.filter((r) => incluye(r.categoria)) }))
    .filter((p) => p.renglones.length);
  const bajoMinimo = datos.bajoMinimo.filter((b) => incluye(b.categoria));
  const perecederos = datos.perecederos.filter((p) => incluye(p.categoria));

  const resumen: string[] = [`*${titulo} ${datos.fecha} — CEDIS*`, ""];
  if (proveedores.length) {
    resumen.push("Recepciones con diferencia:");
    for (const p of proveedores) {
      resumen.push(`_${p.nombre}_`);
      resumen.push(...p.renglones.map(renglonTexto));
    }
    resumen.push("");
  } else resumen.push("Todas las recepciones de hoy llegaron completas.", "");
  if (bajoMinimo.length) {
    resumen.push(`Bajo mínimo (${bajoMinimo.length}):`);
    resumen.push(...bajoMinimo.slice(0, LIMITE_RENGLONES).map((b) => `• ${b.nombre}: hay ${b.existencia}, mínimo ${b.minimo}`));
    if (bajoMinimo.length > LIMITE_RENGLONES) resumen.push(`…y ${bajoMinimo.length - LIMITE_RENGLONES} más en Mínimos y productos clave.`);
    resumen.push("");
  }
  if (perecederos.length) {
    resumen.push("Perecederos por mover primero:");
    resumen.push(...perecederos.slice(0, LIMITE_RENGLONES).map((p) => `• ${p.nombre}: ${p.estado}. ${p.recomendacion}`));
    resumen.push("");
  }
  resumen.push(`Necesidades de compra pendientes de ordenar: ${datos.necesidadesPendientes}.`);
  const renglones = proveedores.reduce((n, p) => n + p.renglones.length, 0) + bajoMinimo.length + perecederos.length;
  return { mensaje: resumen.join("\n"), renglones };
}

function renglonTexto(r: RenglonProveedor) {
  const partes = [`• ${r.producto}: ${fmt(r.recibido)} recibidas vs ${fmt(r.ordenado)} pedidas`];
  if (r.rechazado > 0) partes.push(`se regresan ${fmt(r.rechazado)} (${r.motivo})`);
  else if (r.recibido < r.ordenado) partes.push(`faltan ${fmt(r.ordenado - r.recibido - r.rechazado)}`);
  return partes.join(" — ");
}

export async function armarFaltantesDelDia(fecha?: string): Promise<FaltantesDelDia> {
  const zona = await zonaCedis();
  const dia = fecha ?? fechaEnZona(new Date(), zona);
  const operacion = await obtenerConfiguracionOperacion();

  const ordenes = await OrdenCompra.find({
    estado: "recibida",
    fechaRecepcion: { $gte: inicioDelDiaEnZona(dia, zona), $lte: finDelDiaEnZona(dia, zona) },
  }).lean();
  // La categoría de cada producto decide a qué grupo de la lista le toca.
  const idsRecibidos = ordenes.flatMap((o) => o.items.map((i: { productoId: unknown }) => i.productoId));
  const categoriaDe = new Map(
    (await Producto.find({ _id: { $in: idsRecibidos } }).select("categoria").lean()).map((p) => [String(p._id), String(p.categoria ?? "")])
  );

  const porProveedorMap = new Map<string, RenglonProveedor[]>();
  for (const orden of ordenes) {
    for (const item of orden.items) {
      const recibido = item.cantidadRecibida ?? 0;
      const rechazado = item.cantidadRechazada ?? 0;
      if (recibido >= item.cantidadOrdenada && rechazado <= 0) continue;
      const clave = String(orden.proveedorId);
      porProveedorMap.set(clave, [
        ...(porProveedorMap.get(clave) ?? []),
        {
          folio: orden.folio,
          producto: item.nombreProducto,
          categoria: categoriaDe.get(String(item.productoId)) ?? "",
          ordenado: item.cantidadOrdenada,
          recibido,
          rechazado,
          motivo: MOTIVO_RECHAZO_LABEL[item.motivoRechazo as MotivoRechazo] ?? "",
        },
      ]);
    }
  }
  const proveedores = await Proveedor.find({ _id: { $in: [...porProveedorMap.keys()] } }).select("nombre contacto whatsapp").lean();
  const porProveedor = proveedores
    .map((p) => {
      const renglones = porProveedorMap.get(String(p._id)) ?? [];
      const saludo = p.contacto ? `Buen día, ${p.contacto}.` : "Buen día.";
      const mensaje = [`${saludo} Faltantes y devoluciones del ${dia} — Titos CEDIS`, "", ...renglones.map(renglonTexto), "", "Por favor confírmanos cuándo se reponen."].join("\n");
      return { proveedorId: String(p._id), nombre: p.nombre, whatsapp: p.whatsapp ?? "", renglones, mensaje };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Bajo mínimo del CEDIS con el mínimo vigente (incluye temporada alta).
  const productos = await Producto.find({ activo: true, $or: [{ stockMinimo: { $gt: 0 } }, { minimoTemporadaAlta: { $gt: 0 } }] })
    .select("nombre categoria unidad existenciaMatriz stockMinimo minimoTemporadaAlta piezasPorCaja cajasPorTarima esClave")
    .lean();
  const bajoMinimo = productos
    .map((p) => ({ p, minimo: minimoVigente(p, dia, operacion.temporadaAlta) }))
    .filter(({ p, minimo }) => minimo > 0 && p.existenciaMatriz <= minimo)
    .sort((a, b) => Number(!!b.p.esClave) - Number(!!a.p.esClave) || a.p.existenciaMatriz / a.minimo - b.p.existenciaMatriz / b.minimo)
    .map(({ p, minimo }) => ({ nombre: p.nombre, categoria: String(p.categoria ?? ""), existencia: enPresentacion(p.existenciaMatriz, p), minimo: enPresentacion(minimo, p) }));

  const [necesidadesPendientes, rotacion] = await Promise.all([
    NecesidadCompra.countDocuments({ estado: "pendiente" }),
    rotacionPerecederos(),
  ]);
  // Al mensaje solo va lo que hay que mover ya. Lo "sin fecha" (existencia más
  // vieja que el historial) se revisa en la pantalla de rotación: el primer mes
  // serían casi todos los perecederos y taparía lo urgente.
  const urgentes = rotacion.filter((r) => r.estado === "urgente" || r.estado === "vencido" || (r.estado === "madurando" && r.excedente > 0));
  const categoriaPerecedero = new Map(
    (await Producto.find({ _id: { $in: urgentes.map((r) => r.productoId) } }).select("categoria").lean()).map((p) => [String(p._id), String(p.categoria ?? "")])
  );
  const perecederos = urgentes.map((r) => ({
    nombre: r.nombre,
    categoria: categoriaPerecedero.get(r.productoId) ?? "",
    estado: ESTADO_ROTACION_LABEL[r.estado],
    recomendacion: r.recomendacion,
  }));

  const datos = { fecha: dia, porProveedor, bajoMinimo, necesidadesPendientes, perecederos };

  // Cada grupo recibe solo sus categorías; lo que no cae en ninguno es "el resto".
  const grupos = ((operacion.faltantesDiarios?.segmentos ?? []) as Segmento[]).map((g) => ({
    nombre: g.nombre,
    destinatarios: (g.destinatarios ?? []).filter((d) => d.trim()),
    categorias: new Set((g.categorias ?? []).map(normalizar)),
  }));
  const segmentos = grupos.map((g) => ({
    nombre: g.nombre,
    destinatarios: g.destinatarios,
    ...resumenFiltrado(datos, (c) => g.categorias.has(normalizar(c)), `Faltantes de ${g.nombre} del día`),
  }));
  const enAlgunGrupo = (c: string) => grupos.some((g) => g.categorias.has(normalizar(c)));
  const resumenInterno = resumenFiltrado(datos, () => true, "Faltantes del día").mensaje;
  // Con grupos (frutas y verduras para Alonso, abarrotes para Compras), Compras
  // y el almacén reciben solo lo que no es de ningún grupo, salvo que se pida la
  // lista completa.
  const soloResto = grupos.some((g) => g.destinatarios.length) && operacion.faltantesDiarios?.generalSoloResto !== false;

  return {
    ...datos,
    resumenInterno,
    segmentos,
    resumenGeneral: soloResto ? resumenFiltrado(datos, (c) => !enAlgunGrupo(c), "Faltantes del día (sin grupos)").mensaje : resumenInterno,
  };
}

export type ResultadoEnvioFaltantes = {
  enviado: boolean;
  motivo?: string;
  fecha: string;
  mensajesEnviados: number;
  mensajesFallidos: number;
  errores: string[];
};

/**
 * Manda la lista del día. Sin `forzar`, no repite un día que ya se mandó (el
 * cron pasa cada hora); el botón de la pantalla la puede reenviar.
 */
export async function enviarFaltantesDelDia({ origen, forzar = false }: { origen: "cron" | "manual"; forzar?: boolean }): Promise<ResultadoEnvioFaltantes> {
  const datos = await armarFaltantesDelDia();
  const base = { fecha: datos.fecha, mensajesEnviados: 0, mensajesFallidos: 0, errores: [] as string[] };
  if (!forzar && (await EnvioFaltantes.exists({ fecha: datos.fecha }))) return { ...base, enviado: false, motivo: "La lista de hoy ya se mandó" };

  const [config, operacion] = await Promise.all([obtenerConfiguracion(), obtenerConfiguracionOperacion()]);
  const internos = [...new Set([...(config.alertas?.destinatariosCompras ?? []), ...(operacion.faltantesDiarios?.destinatariosAlmacen ?? [])].filter((d: string) => d.trim()))];
  const envios: { numero: string; mensaje: string }[] = internos.map((numero) => ({ numero, mensaje: datos.resumenGeneral }));
  for (const g of datos.segmentos) for (const numero of g.destinatarios) envios.push({ numero, mensaje: g.mensaje });
  if (operacion.faltantesDiarios?.enviarAProveedores === true) {
    for (const p of datos.porProveedor) if (p.whatsapp) envios.push({ numero: p.whatsapp, mensaje: p.mensaje });
  }
  if (!envios.length) return { ...base, enviado: false, motivo: "No hay destinatarios: captura el WhatsApp de Compras o del almacén" };

  for (const envio of envios) {
    try {
      await sendMessage(envio.numero, envio.mensaje);
      base.mensajesEnviados++;
    } catch (error) {
      base.mensajesFallidos++;
      base.errores.push(`${envio.numero}: ${(error as Error).message}`);
    }
  }
  // Solo se da el día por avisado si llegó algo; si todo falló, el siguiente barrido reintenta.
  if (base.mensajesEnviados > 0) {
    await EnvioFaltantes.findOneAndUpdate(
      { fecha: datos.fecha },
      { $set: { enviadoEn: new Date(), origen, mensajesEnviados: base.mensajesEnviados, mensajesFallidos: base.mensajesFallidos, errores: base.errores } },
      { upsert: true }
    );
  }
  return { ...base, enviado: base.mensajesEnviados > 0 };
}

/** Lo llama el cron cada hora: manda la lista cuando ya pasó la hora configurada. */
export async function revisarFaltantesProgramados(ahora = new Date()) {
  const operacion = await obtenerConfiguracionOperacion();
  if (operacion.faltantesDiarios?.activo === false) return { enviado: false, motivo: "El envío diario de faltantes está desactivado" };
  const zona = await zonaCedis();
  const hora = operacion.faltantesDiarios?.hora ?? "13:00";
  if (horaEnZona(ahora, zona) < hora) return { enviado: false, motivo: `Se manda a partir de las ${hora}` };
  return enviarFaltantesDelDia({ origen: "cron" });
}
