import Venta from "@/models/Venta";
import Sucursal from "@/models/Sucursal";
import { METODOS_PAGO } from "@/models/Venta";
import { ETIQUETA_TIPO_TARJETA, TIPOS_TARJETA, esTipoTarjeta, type TipoTarjeta } from "@/lib/tarjetas";

export type MetodoPago = (typeof METODOS_PAGO)[number];

export type FiltroHistorialVentas = {
  sucursalId?: string | null;
  desde?: string | null;
  hasta?: string | null;
  /** "excluir" (default), "incluir" o "solo": qué hacer con las notas de venta. */
  notasDeVenta?: "excluir" | "incluir" | "solo";
  /** Las canceladas no suman dinero, pero sirven para auditar. */
  incluirCanceladas?: boolean;
};

export type VentaHistorial = {
  _id: string;
  folio: string;
  fecha: string;
  corte: string;
  sucursalId: string;
  sucursalNombre: string;
  clienteNombre: string;
  total: number;
  pagos: { metodoPago: string; monto: number; tarjetaTipo?: string | null }[];
  estado: string;
  esVentas2: boolean;
  articulos: number;
};

export type ResumenHistorialVentas = {
  cantidad: number;
  total: number;
  ticketPromedio: number;
  canceladas: number;
  totalCancelado: number;
  porMetodo: Record<MetodoPago, number>;
  /** Lo cobrado con tarjeta partido por crédito, débito y American Express. */
  porTipoTarjeta: { tipo: TipoTarjeta | null; etiqueta: string; monto: number }[];
  porSucursal: { sucursalId: string; nombre: string; cantidad: number; total: number }[];
  porDia: { corte: string; cantidad: number; total: number }[];
};

/**
 * El filtro de fechas usa el campo `corte` (YYYY-MM-DD), que ya viene calculado
 * en la zona horaria de cada sucursal. Compararlo como texto evita reinterpretar
 * las fechas en la zona del servidor (UTC en producción), que desplazaría un día
 * las ventas de la tarde.
 */
export function construirFiltro(filtro: FiltroHistorialVentas) {
  const query: Record<string, unknown> = {};

  if (filtro.sucursalId) query.sucursalId = filtro.sucursalId;

  if (filtro.desde || filtro.hasta) {
    const rango: Record<string, string> = {};
    if (filtro.desde) rango.$gte = filtro.desde;
    if (filtro.hasta) rango.$lte = filtro.hasta;
    query.corte = rango;
  }

  if (filtro.notasDeVenta === "solo") query.esVentas2 = true;
  else if (filtro.notasDeVenta !== "incluir") query.esVentas2 = { $ne: true };

  if (!filtro.incluirCanceladas) query.estado = "completada";

  return query;
}

export function filtroDesdeUrl(url: URL): FiltroHistorialVentas {
  const notas = url.searchParams.get("notasDeVenta");
  return {
    sucursalId: url.searchParams.get("sucursalId"),
    desde: url.searchParams.get("desde"),
    hasta: url.searchParams.get("hasta"),
    notasDeVenta: notas === "incluir" || notas === "solo" ? notas : "excluir",
    incluirCanceladas: url.searchParams.get("incluirCanceladas") === "1",
  };
}

export async function consultarHistorialVentas(filtro: FiltroHistorialVentas) {
  const ventas = await Venta.find(construirFiltro(filtro))
    .select("folio fecha corte sucursalId clienteNombre total pagos estado esVentas2 items")
    .sort({ fecha: -1 })
    .limit(2000)
    .lean();

  const sucursales = await Sucursal.find({}).select("nombre").lean();
  const nombrePorSucursal = new Map(sucursales.map((s) => [String(s._id), s.nombre as string]));

  const filas: VentaHistorial[] = ventas.map((v) => ({
    _id: String(v._id),
    folio: v.folio,
    fecha: v.fecha ? new Date(v.fecha).toISOString() : "",
    corte: v.corte,
    sucursalId: String(v.sucursalId),
    sucursalNombre: nombrePorSucursal.get(String(v.sucursalId)) ?? "Sucursal",
    clienteNombre: v.clienteNombre ?? "",
    total: v.total,
    pagos: ((v.pagos ?? []) as { metodoPago: string; monto: number; tarjetaTipo?: string | null }[]).map((p) => ({
      metodoPago: p.metodoPago,
      monto: p.monto,
      tarjetaTipo: p.tarjetaTipo ?? null,
    })),
    estado: v.estado,
    esVentas2: !!v.esVentas2,
    articulos: (v.items ?? []).length,
  }));

  return { filas, resumen: resumirVentas(filas) };
}

export function resumirVentas(filas: VentaHistorial[]): ResumenHistorialVentas {
  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0])) as Record<MetodoPago, number>;
  const porTipoTarjeta = new Map<string, { tipo: TipoTarjeta | null; etiqueta: string; monto: number }>();
  const porSucursal = new Map<string, { sucursalId: string; nombre: string; cantidad: number; total: number }>();
  const porDia = new Map<string, { corte: string; cantidad: number; total: number }>();

  let total = 0;
  let cantidad = 0;
  let canceladas = 0;
  let totalCancelado = 0;

  for (const fila of filas) {
    // Una venta cancelada no entra en los totales de dinero: se reporta aparte.
    if (fila.estado === "cancelada") {
      canceladas += 1;
      totalCancelado += fila.total;
      continue;
    }

    cantidad += 1;
    total += fila.total;

    for (const pago of fila.pagos) {
      if (pago.metodoPago in porMetodo) porMetodo[pago.metodoPago as MetodoPago] += pago.monto;

      if (pago.metodoPago === "tarjeta") {
        // Las ventas anteriores al tipo de tarjeta se agrupan aparte.
        const tipo = esTipoTarjeta(pago.tarjetaTipo) ? pago.tarjetaTipo : null;
        const clave = tipo ?? "";
        const acumulado = porTipoTarjeta.get(clave) ?? {
          tipo,
          etiqueta: tipo ? ETIQUETA_TIPO_TARJETA[tipo] : "Sin tipo identificado",
          monto: 0,
        };
        acumulado.monto += pago.monto;
        porTipoTarjeta.set(clave, acumulado);
      }
    }

    const sucursal = porSucursal.get(fila.sucursalId) ?? {
      sucursalId: fila.sucursalId,
      nombre: fila.sucursalNombre,
      cantidad: 0,
      total: 0,
    };
    sucursal.cantidad += 1;
    sucursal.total += fila.total;
    porSucursal.set(fila.sucursalId, sucursal);

    const dia = porDia.get(fila.corte) ?? { corte: fila.corte, cantidad: 0, total: 0 };
    dia.cantidad += 1;
    dia.total += fila.total;
    porDia.set(fila.corte, dia);
  }

  const redondear = (n: number) => Math.round(n * 100) / 100;

  return {
    cantidad,
    total: redondear(total),
    ticketPromedio: cantidad > 0 ? redondear(total / cantidad) : 0,
    canceladas,
    totalCancelado: redondear(totalCancelado),
    porMetodo: Object.fromEntries(
      Object.entries(porMetodo).map(([k, v]) => [k, redondear(v)])
    ) as Record<MetodoPago, number>,
    porTipoTarjeta: [...porTipoTarjeta.values()]
      .map((t) => ({ ...t, monto: redondear(t.monto) }))
      // Orden fijo del catálogo, con los no identificados al final.
      .sort(
        (a, b) =>
          (a.tipo ? TIPOS_TARJETA.indexOf(a.tipo) : TIPOS_TARJETA.length) -
          (b.tipo ? TIPOS_TARJETA.indexOf(b.tipo) : TIPOS_TARJETA.length)
      ),
    porSucursal: [...porSucursal.values()]
      .map((s) => ({ ...s, total: redondear(s.total) }))
      .sort((a, b) => b.total - a.total),
    porDia: [...porDia.values()].map((d) => ({ ...d, total: redondear(d.total) })).sort((a, b) => a.corte.localeCompare(b.corte)),
  };
}
