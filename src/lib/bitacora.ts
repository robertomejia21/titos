import CancelacionPos from "@/models/CancelacionPos";
import Devolucion from "@/models/Devolucion";
import MovimientoCaja from "@/models/MovimientoCaja";
import Pedido from "@/models/Pedido";
import PrestamoSucursal from "@/models/PrestamoSucursal";
import Sucursal from "@/models/Sucursal";
import UserModel from "@/models/User";

// Bitácora unificada de acciones críticas. Cada módulo ya venía guardando quién
// hizo qué (cancelaciones, devoluciones, retiros, surtidos, préstamos), pero
// cada uno en su propia colección y con su propio formato, así que no había
// forma de responder "¿qué hizo esta persona el martes?" sin abrir cinco
// pantallas. Aquí se normalizan todas a un mismo renglón.

export const TIPOS_BITACORA = [
  "cancelacion",
  "devolucion",
  "retiro",
  "surtido",
  "recepcion",
  "prestamo",
] as const;

export type TipoBitacora = (typeof TIPOS_BITACORA)[number];

export const ETIQUETA_TIPO: Record<TipoBitacora, string> = {
  cancelacion: "Cancelación",
  devolucion: "Devolución",
  retiro: "Retiro de efectivo",
  surtido: "Surtido de pedido",
  recepcion: "Recepción de pedido",
  prestamo: "Préstamo entre sucursales",
};

/** Renglón de producto de un evento que los tenga (hoy, las cancelaciones). */
export type ItemBitacora = {
  nombreProducto: string;
  cantidad: number;
  unidad: string;
  importe: number;
};

export type EventoBitacora = {
  id: string;
  tipo: TipoBitacora;
  fecha: string;
  folio: string;
  sucursalId: string | null;
  sucursalNombre: string;
  usuarioId: string | null;
  usuarioNombre: string;
  /** Qué pasó, en una línea. */
  descripcion: string;
  /** Motivo capturado, cuando el módulo lo pide. */
  detalle: string;
  importe: number | null;
  /**
   * Productos del evento. En una cancelación parcial (quitar un renglón del
   * carrito) es el dato que de verdad se audita: qué producto se quitó y
   * cuánto. Antes solo se veía el importe, y con eso no se puede distinguir
   * entre un error de captura y alguien vaciando el carrito a propósito.
   */
  items: ItemBitacora[];
};

export type FiltrosBitacora = {
  desde?: Date;
  hasta?: Date;
  sucursalId?: string;
  usuarioId?: string;
  tipos?: TipoBitacora[];
};

/** Tope por fuente antes de mezclar, para no traer media base en un rango amplio. */
const LIMITE_POR_FUENTE = 300;

function rangoFecha(campo: string, filtros: FiltrosBitacora) {
  if (!filtros.desde && !filtros.hasta) return {};
  const rango: Record<string, Date> = {};
  if (filtros.desde) rango.$gte = filtros.desde;
  if (filtros.hasta) rango.$lte = filtros.hasta;
  return { [campo]: rango };
}

function quiere(filtros: FiltrosBitacora, tipo: TipoBitacora) {
  return !filtros.tipos || filtros.tipos.length === 0 || filtros.tipos.includes(tipo);
}

/** Cantidad legible: los kilos llevan decimales y las piezas no. */
function cantidadTexto(item: ItemBitacora) {
  const cantidad = item.unidad === "kg" ? item.cantidad.toFixed(3) : String(item.cantidad);
  return `${cantidad}${item.unidad ? ` ${item.unidad}` : ""}`;
}

/**
 * "Leche Lala x 2 pieza" para una cancelación de un renglón; para varias, el
 * primero y cuántos más, que la lista completa ya va en `items`.
 *
 * El renglón de la bitácora se lee de corrido y en voz alta al auditar, así que
 * dice el producto y no la mecánica ("del carrito"): quien revisa ya sabe de
 * dónde se quitó, lo que necesita saber es qué.
 */
export function resumenItems(items: ItemBitacora[]) {
  if (items.length === 0) return "sin productos capturados";
  const primero = `${items[0].nombreProducto} x ${cantidadTexto(items[0])}`;
  return items.length === 1 ? primero : `${primero} y ${items.length - 1} producto(s) más`;
}

function money(valor: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

export async function consultarBitacora(filtros: FiltrosBitacora, limite = 200): Promise<EventoBitacora[]> {
  const eventos: EventoBitacora[] = [];
  const porSucursal = filtros.sucursalId ? { sucursalId: filtros.sucursalId } : {};

  // ---------- Cancelaciones ----------
  if (quiere(filtros, "cancelacion")) {
    const filas = await CancelacionPos.find({ ...porSucursal, ...rangoFecha("fecha", filtros) })
      .sort({ fecha: -1 })
      .limit(LIMITE_POR_FUENTE)
      .lean();

    for (const c of filas) {
      const items: ItemBitacora[] = (c.items ?? []).map((i: Partial<ItemBitacora>) => ({
        nombreProducto: i.nombreProducto ?? "",
        cantidad: i.cantidad ?? 0,
        unidad: i.unidad ?? "",
        importe: i.importe ?? 0,
      }));

      eventos.push({
        id: String(c._id),
        tipo: "cancelacion",
        fecha: (c.fecha ?? c.createdAt).toISOString(),
        folio: c.folio,
        sucursalId: c.sucursalId ? String(c.sucursalId) : null,
        sucursalNombre: c.sucursalNombre ?? "",
        usuarioId: c.usuarioId ? String(c.usuarioId) : null,
        usuarioNombre: c.usuarioNombre ?? "",
        descripcion:
          c.tipo === "venta"
            ? `Canceló la venta cobrada ${c.ventaFolio || ""}`.trim()
            : c.tipo === "carrito"
              ? `Canceló una venta en curso (${resumenItems(items)})`
              : `Quitó ${resumenItems(items)}`,
        // Quién autorizó (o que nadie lo hizo) es justo lo que matriz necesita
        // ver de un vistazo al revisar una cancelación.
        detalle: [
          c.motivo,
          c.autorizadoPorNombre
            ? `autorizó ${c.autorizadoPorNombre}`
            : c.autorizadoConNip
              ? "autorizado con el NIP general"
              : "sin NIP de supervisor",
        ]
          .filter(Boolean)
          .join(" · "),
        importe: c.importe ?? null,
        items,
      });
    }
  }

  // ---------- Devoluciones ----------
  if (quiere(filtros, "devolucion")) {
    const filas = await Devolucion.find({ ...porSucursal, ...rangoFecha("fecha", filtros) })
      .sort({ fecha: -1 })
      .limit(LIMITE_POR_FUENTE)
      .lean();

    for (const d of filas) {
      eventos.push({
        id: String(d._id),
        tipo: "devolucion",
        fecha: d.fecha.toISOString(),
        folio: d.folio,
        sucursalId: String(d.sucursalId),
        sucursalNombre: "",
        usuarioId: d.usuarioId ? String(d.usuarioId) : null,
        usuarioNombre: "",
        descripcion: `Devolución de la venta ${d.ventaFolio} (${d.estado})`,
        detalle: d.motivo || "",
        importe: d.total,
        items: [],
      });

      // Pagar el reembolso es un movimiento de dinero aparte, y puede haberlo
      // hecho otra persona en otro turno: va como su propio renglón.
      if (d.pagadaEn && d.pagadaPorId) {
        eventos.push({
          id: `${d._id}-pago`,
          tipo: "devolucion",
          fecha: d.pagadaEn.toISOString(),
          folio: d.folio,
          sucursalId: String(d.sucursalId),
          sucursalNombre: "",
          usuarioId: String(d.pagadaPorId),
          usuarioNombre: "",
          descripcion: `Pagó el reembolso de la devolución ${d.folio}`,
          detalle: "",
          importe: d.montoEfectivo ?? 0,
          items: [],
        });
      }
    }
  }

  // ---------- Retiros de efectivo ----------
  if (quiere(filtros, "retiro")) {
    const filas = await MovimientoCaja.find({ ...porSucursal, ...rangoFecha("fecha", filtros) })
      .sort({ fecha: -1 })
      .limit(LIMITE_POR_FUENTE)
      .lean();

    for (const m of filas) {
      eventos.push({
        id: String(m._id),
        tipo: "retiro",
        fecha: m.fecha.toISOString(),
        folio: m.folio,
        sucursalId: String(m.sucursalId),
        sucursalNombre: "",
        usuarioId: m.usuarioId ? String(m.usuarioId) : null,
        usuarioNombre: m.usuarioNombre ?? "",
        descripcion: `Retiró efectivo de la caja (${m.moneda})`,
        detalle: [m.motivo, m.autorizadoPorNombre ? `autorizó ${m.autorizadoPorNombre}` : ""]
          .filter(Boolean)
          .join(" · "),
        importe: m.monto,
        items: [],
      });
    }
  }

  // ---------- Surtidos y recepciones de pedidos ----------
  if (quiere(filtros, "surtido") || quiere(filtros, "recepcion")) {
    const condiciones: Record<string, unknown>[] = [];
    if (quiere(filtros, "surtido")) condiciones.push({ surtidoEn: { $ne: null }, ...rangoFecha("surtidoEn", filtros) });
    if (quiere(filtros, "recepcion")) {
      condiciones.push({ recibidoEn: { $ne: null }, ...rangoFecha("recibidoEn", filtros) });
    }

    const filas = await Pedido.find({ ...porSucursal, $or: condiciones })
      .select("folio sucursalId surtidoEn surtidoPorId recibidoEn recibidoPorId items")
      .sort({ updatedAt: -1 })
      .limit(LIMITE_POR_FUENTE)
      .lean();

    for (const p of filas) {
      const piezas = (p.items ?? []).length;

      if (quiere(filtros, "surtido") && p.surtidoEn && p.surtidoPorId) {
        eventos.push({
          id: `${p._id}-surtido`,
          tipo: "surtido",
          fecha: p.surtidoEn.toISOString(),
          folio: p.folio,
          sucursalId: String(p.sucursalId),
          sucursalNombre: "",
          usuarioId: String(p.surtidoPorId),
          usuarioNombre: "",
          descripcion: `Surtió el pedido ${p.folio} (${piezas} productos)`,
          detalle: "",
          importe: null,
          items: [],
        });
      }

      if (quiere(filtros, "recepcion") && p.recibidoEn && p.recibidoPorId) {
        eventos.push({
          id: `${p._id}-recibido`,
          tipo: "recepcion",
          fecha: p.recibidoEn.toISOString(),
          folio: p.folio,
          sucursalId: String(p.sucursalId),
          sucursalNombre: "",
          usuarioId: String(p.recibidoPorId),
          usuarioNombre: "",
          descripcion: `Registró la recepción del pedido ${p.folio}`,
          detalle: "",
          importe: null,
          items: [],
        });
      }
    }
  }

  // ---------- Préstamos entre sucursales ----------
  if (quiere(filtros, "prestamo")) {
    const porSucursalPrestamo = filtros.sucursalId
      ? {
          $or: [
            { sucursalSolicitanteId: filtros.sucursalId },
            { sucursalPrestamistaId: filtros.sucursalId },
          ],
        }
      : {};

    const filas = await PrestamoSucursal.find({ ...porSucursalPrestamo, ...rangoFecha("solicitadoEn", filtros) })
      .sort({ solicitadoEn: -1 })
      .limit(LIMITE_POR_FUENTE)
      .lean();

    for (const pr of filas) {
      eventos.push({
        id: String(pr._id),
        tipo: "prestamo",
        fecha: pr.solicitadoEn.toISOString(),
        folio: pr.folio,
        sucursalId: String(pr.sucursalSolicitanteId),
        sucursalNombre: pr.sucursalSolicitanteNombre ?? "",
        usuarioId: pr.solicitadoPorId ? String(pr.solicitadoPorId) : null,
        usuarioNombre: "",
        descripcion: `Pidió prestado a ${pr.sucursalPrestamistaNombre || "otra sucursal"} (${pr.estado})`,
        detalle: pr.motivoRechazo || pr.notas || "",
        importe: null,
        items: [],
      });

      if (pr.resueltoEn && pr.resueltoPorId) {
        eventos.push({
          id: `${pr._id}-resuelto`,
          tipo: "prestamo",
          fecha: pr.resueltoEn.toISOString(),
          folio: pr.folio,
          sucursalId: String(pr.sucursalPrestamistaId),
          sucursalNombre: pr.sucursalPrestamistaNombre ?? "",
          usuarioId: String(pr.resueltoPorId),
          usuarioNombre: "",
          descripcion: `Resolvió el préstamo ${pr.folio} (${pr.estado})`,
          detalle: pr.motivoRechazo || "",
          importe: null,
          items: [],
        });
      }
    }
  }

  // ---------- Filtro por usuario, orden y corte ----------
  let resultado = eventos;
  if (filtros.usuarioId) {
    resultado = resultado.filter((e) => e.usuarioId === filtros.usuarioId);
  }
  resultado.sort((a, b) => b.fecha.localeCompare(a.fecha));
  resultado = resultado.slice(0, limite);

  // ---------- Nombres que no venían desnormalizados ----------
  const idsUsuario = [...new Set(resultado.filter((e) => !e.usuarioNombre && e.usuarioId).map((e) => e.usuarioId!))];
  const idsSucursal = [...new Set(resultado.filter((e) => !e.sucursalNombre && e.sucursalId).map((e) => e.sucursalId!))];

  const [usuarios, sucursales] = await Promise.all([
    idsUsuario.length ? UserModel.find({ _id: { $in: idsUsuario } }).select("nombre").lean() : [],
    idsSucursal.length ? Sucursal.find({ _id: { $in: idsSucursal } }).select("nombre").lean() : [],
  ]);

  const nombreUsuario = new Map(usuarios.map((u) => [String(u._id), u.nombre]));
  const nombreSucursal = new Map(sucursales.map((s) => [String(s._id), s.nombre]));

  for (const evento of resultado) {
    if (!evento.usuarioNombre && evento.usuarioId) {
      evento.usuarioNombre = nombreUsuario.get(evento.usuarioId) ?? "Usuario dado de baja";
    }
    if (!evento.sucursalNombre && evento.sucursalId) {
      evento.sucursalNombre = nombreSucursal.get(evento.sucursalId) ?? "";
    }
  }

  return resultado;
}

/** Texto de apoyo para el importe, que no todos los tipos tienen. */
export function importeBitacora(evento: EventoBitacora) {
  return evento.importe == null ? "—" : money(evento.importe);
}
