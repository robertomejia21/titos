import { Types } from "mongoose";
import Venta from "@/models/Venta";
import Sucursal from "@/models/Sucursal";
import Ventas2ActivacionModel, { type Ventas2Activacion as Ventas2ActivacionType } from "@/models/Ventas2Activacion";
import { sendMessage as enviarWhatsApp } from "@/lib/greenApi";
import { formatFechaHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

export type EstadoVentas2 = "programada" | "activa" | "finalizada" | "cancelada";
type PagoLike = { metodoPago: string; monto: number };
type Ventas2ActivacionDoc = Ventas2ActivacionType & { save: () => Promise<unknown> };
type NotificacionResumenSource = { estado?: string; fecha?: Date | null; error?: string };
type ActivacionResumenSource = Pick<Ventas2ActivacionType, "inicio" | "fin" | "frecuencia" | "estado"> & {
  _id: unknown;
  sucursalId: unknown;
  notificacionInicio?: NotificacionResumenSource | null;
  notificacionFin?: NotificacionResumenSource | null;
  retiradoEn?: Date | null;
};

/**
 * Condición de "todavía corriendo" para las consultas: un protocolo indefinido
 * (`fin: null`) nunca vence solo, así que hay que dejarlo pasar aparte. Mongo no
 * lo incluiría en un `$gt` porque las comparaciones solo casan con el mismo tipo.
 */
function sinVencer(ahora: Date) {
  return { $or: [{ fin: null }, { fin: { $gt: ahora } }] };
}

export function calcularEstadoVentas2(
  activacion: Pick<Ventas2ActivacionType, "estado" | "inicio" | "fin">,
  ahora = new Date()
): EstadoVentas2 {
  if (activacion.estado === "cancelada") return "cancelada";
  // Sin fecha de fin el protocolo sigue vivo hasta que matriz lo detenga.
  if (activacion.fin && activacion.fin <= ahora) return "finalizada";
  if (activacion.inicio <= ahora) return "activa";
  return "programada";
}

// El aviso lo lee la sucursal, así que las horas van en su zona horaria.
function formatoFecha(fecha: Date, zona: string = ZONA_HORARIA_DEFAULT) {
  return formatFechaHora(fecha, zona);
}

/** Renglon del aviso con el lapso; sin fecha de fin se avisa que es indefinido. */
function lapso(inicio: Date, fin: Date | null | undefined, zona: string) {
  if (!fin) return `Lapso: desde ${formatoFecha(inicio, zona)} y hasta nuevo aviso (sin fecha de fin).`;
  return `Lapso: ${formatoFecha(inicio, zona)} a ${formatoFecha(fin, zona)}.`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

function esPagoSoloEfectivo(pagos: PagoLike[]) {
  return pagos.length === 1 && pagos[0]?.metodoPago === "efectivo";
}

async function totalesActivacion(activacionId: string) {
  const ventas = await Venta.find({ ventas2ActivacionId: activacionId, estado: "completada" }).select("total").lean();
  return {
    cantidad: ventas.length,
    total: ventas.reduce((sum, v) => sum + v.total, 0),
  };
}

async function registrarNotificacion(
  activacion: Ventas2ActivacionDoc,
  tipo: "inicio" | "fin",
  mensaje: string,
  ahora: Date
) {
  const sucursal = await Sucursal.findById(activacion.sucursalId).select("nombre whatsapp").lean();
  const campo = tipo === "inicio" ? "notificacionInicio" : "notificacionFin";

  if (!sucursal?.whatsapp) {
    activacion[campo] = { estado: "sin_whatsapp", fecha: ahora, error: "La sucursal no tiene WhatsApp configurado" };
    await activacion.save();
    return;
  }

  try {
    await enviarWhatsApp(sucursal.whatsapp, mensaje);
    activacion[campo] = { estado: "enviada", fecha: ahora, error: "" };
  } catch (err) {
    activacion[campo] = { estado: "fallida", fecha: ahora, error: (err as Error).message };
  }
  await activacion.save();
}

export async function sincronizarVentas2(ahora = new Date()) {
  await Ventas2ActivacionModel.updateMany(
    { estado: "programada", inicio: { $lte: ahora }, ...sinVencer(ahora) },
    { $set: { estado: "activa" } }
  );
  await Ventas2ActivacionModel.updateMany(
    { estado: { $in: ["programada", "activa"] }, fin: { $ne: null, $lte: ahora } },
    { $set: { estado: "finalizada" } }
  );

  const paraInicio = await Ventas2ActivacionModel.find({
    estado: "activa",
    inicio: { $lte: ahora },
    ...sinVencer(ahora),
    "notificacionInicio.estado": "pendiente",
  }).limit(25);

  for (const activacion of paraInicio) {
    const sucursal = await Sucursal.findById(activacion.sucursalId).select("nombre zonaHoraria").lean();
    const zona = sucursal?.zonaHoraria || ZONA_HORARIA_DEFAULT;
    const mensaje = [
      `Notas de venta activado para ${sucursal?.nombre ?? "la sucursal"}.`,
      lapso(activacion.inicio, activacion.fin, zona),
      `Regla: 1 de cada ${activacion.frecuencia} ventas 100% en efectivo se registrara en Notas de venta.`,
      "Revisa el apartado Notas de venta para separar el efectivo correspondiente.",
    ].join("\n");
    await registrarNotificacion(activacion, "inicio", mensaje, ahora);
  }

  const paraFin = await Ventas2ActivacionModel.find({
    estado: "finalizada",
    fin: { $ne: null, $lte: ahora },
    "notificacionFin.estado": "pendiente",
  }).limit(25);

  for (const activacion of paraFin) {
    const sucursal = await Sucursal.findById(activacion.sucursalId).select("nombre zonaHoraria").lean();
    const zona = sucursal?.zonaHoraria || ZONA_HORARIA_DEFAULT;
    const totales = await totalesActivacion(String(activacion._id));
    const mensaje = [
      `Notas de venta finalizo para ${sucursal?.nombre ?? "la sucursal"}.`,
      lapso(activacion.inicio, activacion.fin, zona),
      `Total recaudado: ${formatMoney(totales.total)} en ${totales.cantidad} movimientos.`,
      "Separa el efectivo para que matriz pueda retirarlo.",
    ].join("\n");
    await registrarNotificacion(activacion, "fin", mensaje, ahora);
  }
}

export async function resolverVentas2ParaVenta({
  sucursalId,
  pagos,
  fecha,
}: {
  sucursalId: string;
  pagos: PagoLike[];
  fecha: Date;
}) {
  await sincronizarVentas2(fecha);

  if (!esPagoSoloEfectivo(pagos)) {
    return { esVentas2: false, activacionId: null as string | null, secuenciaEfectivo: null as number | null };
  }

  const activacion = await Ventas2ActivacionModel.findOne({
    sucursalId,
    estado: "activa",
    inicio: { $lte: fecha },
    ...sinVencer(fecha),
  }).sort({ inicio: -1 });

  if (!activacion) {
    return { esVentas2: false, activacionId: null as string | null, secuenciaEfectivo: null as number | null };
  }

  const ventasEfectivoPrevias = await Venta.countDocuments({
    sucursalId,
    estado: "completada",
    fecha: { $gte: activacion.inicio, $lt: fecha },
    "pagos.0.metodoPago": "efectivo",
    "pagos.1": { $exists: false },
  });
  const secuenciaEfectivo = ventasEfectivoPrevias + 1;
  const esVentas2 = secuenciaEfectivo % activacion.frecuencia === 0;

  return {
    esVentas2,
    activacionId: esVentas2 ? String(activacion._id) : null,
    secuenciaEfectivo,
  };
}

export type MovimientoVentas2Resumen = {
  id: string;
  folio: string;
  fecha: string;
  total: number;
  estado: string;
  secuenciaEfectivo: number | null;
};

export type ActivacionVentas2Resumen = {
  id: string;
  sucursalId: string;
  sucursalNombre: string;
  inicio: string;
  /** `null` cuando el protocolo es indefinido y sigue corriendo. */
  fin: string | null;
  frecuencia: number;
  estado: EstadoVentas2;
  totalRecaudado: number;
  cantidadMovimientos: number;
  ultimoMovimiento: string | null;
  notificacionInicio: { estado: string; fecha: string | null; error: string };
  notificacionFin: { estado: string; fecha: string | null; error: string };
  retiradoEn: string | null;
  movimientos: MovimientoVentas2Resumen[];
};

export async function resumirActivacionesVentas2(activaciones: ActivacionResumenSource[], ahora = new Date()) {
  const ids = activaciones.map((a) => a._id);
  const ventas = ids.length
    ? await Venta.find({ ventas2ActivacionId: { $in: ids } })
        .select("folio fecha total estado ventas2ActivacionId ventas2SecuenciaEfectivo")
        .sort({ fecha: -1 })
        .lean()
    : [];

  const ventasPorActivacion = new Map<string, typeof ventas>();
  for (const venta of ventas) {
    const key = String(venta.ventas2ActivacionId);
    const current = ventasPorActivacion.get(key) ?? [];
    current.push(venta);
    ventasPorActivacion.set(key, current);
  }

  return activaciones.map((a) => {
    const sucursal = a.sucursalId as unknown as { _id?: Types.ObjectId; nombre?: string };
    const movimientos = (ventasPorActivacion.get(String(a._id)) ?? []).map((v) => ({
      id: String(v._id),
      folio: v.folio,
      fecha: v.fecha.toISOString(),
      total: v.total,
      estado: v.estado,
      secuenciaEfectivo: v.ventas2SecuenciaEfectivo ?? null,
    }));
    const movimientosCompletados = movimientos.filter((m) => m.estado === "completada");
    const totalRecaudado = movimientosCompletados.reduce((sum, m) => sum + m.total, 0);

    return {
      id: String(a._id),
      sucursalId: String(sucursal?._id ?? a.sucursalId),
      sucursalNombre: sucursal?.nombre ?? "Sucursal",
      inicio: a.inicio.toISOString(),
      fin: a.fin ? a.fin.toISOString() : null,
      frecuencia: a.frecuencia,
      estado: calcularEstadoVentas2(a, ahora),
      totalRecaudado,
      cantidadMovimientos: movimientosCompletados.length,
      ultimoMovimiento: movimientos[0]?.fecha ?? null,
      notificacionInicio: {
        estado: a.notificacionInicio?.estado ?? "pendiente",
        fecha: a.notificacionInicio?.fecha ? a.notificacionInicio.fecha.toISOString() : null,
        error: a.notificacionInicio?.error ?? "",
      },
      notificacionFin: {
        estado: a.notificacionFin?.estado ?? "pendiente",
        fecha: a.notificacionFin?.fecha ? a.notificacionFin.fecha.toISOString() : null,
        error: a.notificacionFin?.error ?? "",
      },
      retiradoEn: a.retiradoEn ? a.retiradoEn.toISOString() : null,
      movimientos,
    };
  });
}
