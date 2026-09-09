import Venta from "@/models/Venta";
import type { ClientSession } from "mongoose";
import MovimientoCaja from "@/models/MovimientoCaja";
import AbonoCliente from "@/models/AbonoCliente";
import Devolucion from "@/models/Devolucion";
import { ETIQUETA_TIPO_TARJETA, TIPOS_TARJETA, esTipoTarjeta, type TipoTarjeta } from "@/lib/tarjetas";

function redondear(valor: number) {
  return Number(valor.toFixed(2));
}

export type TarjetaPorTerminal = { terminalId: string | null; alias: string; monto: number };
/**
 * Lo cobrado con tarjeta partido en crédito, débito y American Express. Cada uno
 * lo liquida el banco por separado y con su propia comisión, así que el depósito
 * no se puede cuadrar con el total junto.
 */
export type TarjetaPorTipo = { tipo: TipoTarjeta | null; etiqueta: string; monto: number };
export type ValesPorEmisor = { emisorId: string | null; nombre: string; monto: number };

export async function calcularResumenSesion(cajaSesionId: string, session?: ClientSession) {
  const ventas = await Venta.find({ cajaSesionId, estado: "completada", esVentas2: { $ne: true } }).select("pagos").session(session ?? null).lean();

  let totalVentasEfectivo = 0;
  let totalVentasTarjeta = 0;
  let totalVentasTransferencia = 0;
  // Los vales de despensa se entregan físicamente pero no son efectivo: se
  // cuentan aparte porque se depositan/cobran al emisor, no en el cajón.
  let totalVentasVales = 0;
  // El crédito no es dinero en caja: se reporta aparte para cuadrar el corte.
  let totalVentasCredito = 0;
  // Dólares en billete recibidos por ventas, su valor en pesos, y el cambio que
  // se devolvió en pesos por esos mismos cobros (sale del cajón de pesos).
  let totalVentasDolaresUsd = 0;
  let totalVentasDolaresMxn = 0;
  let totalCambioDolaresMxn = 0;

  const porTerminal = new Map<string, TarjetaPorTerminal>();
  const porTipoTarjeta = new Map<string, TarjetaPorTipo>();
  const porEmisorVale = new Map<string, ValesPorEmisor>();

  for (const v of ventas) {
    for (const pago of v.pagos) {
      if (pago.metodoPago === "efectivo") totalVentasEfectivo += pago.monto;
      else if (pago.metodoPago === "transferencia") totalVentasTransferencia += pago.monto;
      else if (pago.metodoPago === "vales") {
        totalVentasVales += pago.monto;
        // Los vales de antes de que se identificara el emisor se agrupan aparte
        // en lugar de perderse del desglose.
        const clave = pago.valeEmisorId ? String(pago.valeEmisorId) : "";
        const actual = porEmisorVale.get(clave) ?? {
          emisorId: pago.valeEmisorId ? String(pago.valeEmisorId) : null,
          nombre: pago.valeEmisorNombre || "Sin emisor identificado",
          monto: 0,
        };
        actual.monto += pago.monto;
        porEmisorVale.set(clave, actual);
      }
      else if (pago.metodoPago === "credito") totalVentasCredito += pago.monto;
      else if (pago.metodoPago === "tarjeta") {
        totalVentasTarjeta += pago.monto;
        // Las ventas anteriores a que existiera el tipo de tarjeta se agrupan
        // aparte en vez de inventarles uno.
        const tipoCrudo: unknown = pago.tarjetaTipo;
        const tipo: TipoTarjeta | null = esTipoTarjeta(tipoCrudo) ? tipoCrudo : null;
        const claveTipo = tipo ?? "";
        const acumuladoTipo = porTipoTarjeta.get(claveTipo) ?? {
          tipo,
          etiqueta: tipo ? ETIQUETA_TIPO_TARJETA[tipo] : "Sin tipo identificado",
          monto: 0,
        };
        acumuladoTipo.monto += pago.monto;
        porTipoTarjeta.set(claveTipo, acumuladoTipo);
        // Las ventas anteriores a que existieran las terminales no traen cuál se
        // usó; se agrupan bajo una entrada sin identificar en vez de perderse.
        const clave = pago.terminalId ? String(pago.terminalId) : "";
        const actual = porTerminal.get(clave) ?? {
          terminalId: pago.terminalId ? String(pago.terminalId) : null,
          alias: pago.terminalAlias || "Sin terminal registrada",
          monto: 0,
        };
        actual.monto += pago.monto;
        porTerminal.set(clave, actual);
      } else if (pago.metodoPago === "efectivo_usd") {
        const montoUsd = pago.montoUsd ?? 0;
        const tipoCambio = pago.tipoCambio ?? 0;
        totalVentasDolaresUsd += montoUsd;
        totalVentasDolaresMxn += pago.monto;
        // Lo que el cliente entregó de más, devuelto en pesos.
        totalCambioDolaresMxn += Math.max(0, montoUsd * tipoCambio - pago.monto);
      }
    }
  }

  const tarjetaPorTerminal = [...porTerminal.values()]
    .map((t) => ({ ...t, monto: redondear(t.monto) }))
    .sort((a, b) => b.monto - a.monto);

  // Se ordena por el catálogo (crédito, débito, amex) y no por monto: el corte
  // se lee en el mismo orden todos los días, y los renglones sin tipo al final.
  const ordenTipo = (t: TipoTarjeta | null) => (t ? TIPOS_TARJETA.indexOf(t) : TIPOS_TARJETA.length);
  const tarjetaPorTipo = [...porTipoTarjeta.values()]
    .map((t) => ({ ...t, monto: redondear(t.monto) }))
    .sort((a, b) => ordenTipo(a.tipo) - ordenTipo(b.tipo));

  const valesPorEmisor = [...porEmisorVale.values()]
    .map((v) => ({ ...v, monto: redondear(v.monto) }))
    .sort((a, b) => b.monto - a.monto);

  // Los abonos de clientes sí son cobranza del turno: el efectivo entra al cajón.
  const abonos = await AbonoCliente.find({ cajaSesionId }).select("monto metodoPago").session(session ?? null).lean();
  let totalAbonosEfectivo = 0;
  let totalAbonosOtros = 0;
  for (const abono of abonos) {
    if (abono.metodoPago === "efectivo") totalAbonosEfectivo += abono.monto;
    else totalAbonosOtros += abono.monto;
  }

  // Reembolsos pagados durante este turno, incluidos los de ventas de días
  // anteriores cuyo corte ya estaba cerrado.
  const devoluciones = await Devolucion.find({ cajaSesionId, estado: "pagada" }).select("montoEfectivo").session(session ?? null).lean();
  const totalDevoluciones = devoluciones.reduce((sum, d) => sum + (d.montoEfectivo ?? 0), 0);

  const retiros = await MovimientoCaja.find({ cajaSesionId }).select("monto moneda").session(session ?? null).lean();
  let totalRetiros = 0;
  let totalRetirosUsd = 0;
  for (const retiro of retiros) {
    if (retiro.moneda === "USD") totalRetirosUsd += retiro.monto;
    else totalRetiros += retiro.monto;
  }

  return {
    cantidadVentas: ventas.length,
    cantidadRetiros: retiros.length,
    cantidadAbonos: abonos.length,
    cantidadDevoluciones: devoluciones.length,
    totalVentasEfectivo,
    totalVentasTarjeta,
    totalVentasTransferencia,
    totalVentasVales,
    totalVentasCredito,
    totalVentasDolaresUsd: redondear(totalVentasDolaresUsd),
    totalVentasDolaresMxn: redondear(totalVentasDolaresMxn),
    totalCambioDolaresMxn: redondear(totalCambioDolaresMxn),
    tarjetaPorTerminal,
    tarjetaPorTipo,
    valesPorEmisor,
    totalAbonosEfectivo,
    totalAbonosOtros,
    totalDevoluciones,
    totalRetiros,
    totalRetirosUsd,
  };
}

export type ResumenSesion = Awaited<ReturnType<typeof calcularResumenSesion>>;

/**
 * Efectivo en pesos que debe haber al cerrar: fondo + ventas + cobranza
 * − devoluciones − retiros − el cambio que se dio por los pagos en dólares.
 *
 * El cambio de un pago en dólares sale del cajón de pesos aunque la venta se
 * haya cobrado en billete verde; si no se resta, el corte marca un faltante.
 */
export function calcularEfectivoEsperado(
  efectivoInicial: number,
  resumen: Pick<
    ResumenSesion,
    "totalVentasEfectivo" | "totalAbonosEfectivo" | "totalDevoluciones" | "totalRetiros" | "totalCambioDolaresMxn"
  >
) {
  return redondear(
    efectivoInicial +
      resumen.totalVentasEfectivo +
      resumen.totalAbonosEfectivo -
      resumen.totalDevoluciones -
      resumen.totalRetiros -
      (resumen.totalCambioDolaresMxn ?? 0)
  );
}

/** Dólares que deben quedar: fondo + billetes recibidos en ventas − retiros en USD. */
export function calcularEfectivoEsperadoUsd(
  efectivoInicialUsd: number,
  resumen: Pick<ResumenSesion, "totalRetirosUsd" | "totalVentasDolaresUsd">
) {
  return redondear(efectivoInicialUsd + (resumen.totalVentasDolaresUsd ?? 0) - resumen.totalRetirosUsd);
}
