import Promocion from "@/models/Promocion";
import { calcularPromociones, type ReglaPromocion } from "@/lib/motorPromociones";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Venta, { METODOS_PAGO } from "@/models/Venta";
import Producto from "@/models/Producto";
import MovimientoInventario from "@/models/MovimientoInventario";
import CajaSesion from "@/models/CajaSesion";
import Cliente from "@/models/Cliente";
import CuentaPorCobrar from "@/models/CuentaPorCobrar";
import TerminalPago from "@/models/TerminalPago";
import EmisorValeModel from "@/models/EmisorVale";
import "@/models/Sucursal"; // necesario para que populate("sucursalId") funcione
import { requireSession, unauthorized, forbidden, badRequest, conflict, todayCorte, puede, sinPermiso } from "@/lib/apiAuth";
import { siguienteFolio } from "@/lib/folios";
import { motivoRechazoDolares, obtenerConfiguracion, reglasDolaresDe } from "@/lib/configuracion";
import { alertarInventarioEnCero, type ProductoAgotado } from "@/lib/alertasInventario";
import { esTipoTarjeta, type TipoTarjeta } from "@/lib/tarjetas";
import { resolverVentas2ParaVenta } from "@/lib/ventas2";
import {
  ajustarStockPuntoVenta,
  contextoPuntoVenta,
  stockPuntoVenta,
  ubicacionDeMovimiento,
} from "@/lib/puntoVenta";
import {
  calcularVencimiento,
  motivoRechazoCredito,
  recalcularSaldoCliente,
  resumenCredito,
  zonaHorariaDeSucursal,
  type CuentaLike,
} from "@/lib/credito";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const filter: Record<string, unknown> = {};
  const url = new URL(req.url);
  const ventas2 = url.searchParams.get("ventas2");
  if (session.role === "sucursal") {
    filter.sucursalId = session.sucursalId;
  } else {
    const sucursalId = url.searchParams.get("sucursalId");
    const corte = url.searchParams.get("corte");
    if (sucursalId) filter.sucursalId = sucursalId;
    if (corte) filter.corte = corte;
  }
  if (ventas2 === "only") filter.esVentas2 = true;
  else if (ventas2 !== "include") filter.esVentas2 = { $ne: true };

  const ventas = await Venta.find(filter).sort({ createdAt: -1 }).populate("sucursalId", "nombre").lean();
  return NextResponse.json(ventas);
}

type ItemVenta = { productoId: string; cantidad: number };
type PagoVenta = {
  metodoPago: string;
  monto: number;
  montoUsd?: number | null;
  tipoCambio?: number | null;
  terminalId?: string | null;
  terminalAlias?: string;
  tarjetaTipo?: TipoTarjeta | null;
  valeEmisorId?: string | null;
  valeEmisorNombre?: string;
  valeUltimos4?: string;
};

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "pos.vender")) return sinPermiso("pos.vender");

  const body = await req.json().catch(() => null);
  const items: ItemVenta[] = body?.items ?? [];
  const pagosBody: PagoVenta[] = body?.pagos ?? [];
  const montoRecibido = body?.montoRecibido != null ? Number(body.montoRecibido) : null;
  // Lo genera el punto de venta antes de mandar y no cambia entre reintentos.
  const clienteOperacionId = body?.clienteOperacionId ? String(body.clienteOperacionId) : null;

  if (items.length === 0) return badRequest("La venta debe incluir al menos un producto");
  if (!Array.isArray(items) || !Array.isArray(pagosBody)) return badRequest("Datos de venta inválidos.");

  const metodosUsados = new Set<string>();
  const pagos: PagoVenta[] = [];
  for (const p of pagosBody) {
    if (!METODOS_PAGO.includes(p.metodoPago as (typeof METODOS_PAGO)[number])) {
      return badRequest("Método de pago inválido");
    }
    if (metodosUsados.has(p.metodoPago)) {
      return badRequest("No repitas el mismo método de pago dos veces");
    }
    const monto = Number(p.monto);
    if (!monto || monto <= 0) return badRequest("Cada forma de pago debe tener un monto mayor a cero");
    metodosUsados.add(p.metodoPago);

    const pago: PagoVenta = { metodoPago: p.metodoPago, monto };
    if (p.metodoPago === "efectivo_usd") {
      const montoUsd = Number(p.montoUsd);
      if (!Number.isFinite(montoUsd) || montoUsd <= 0) {
        return badRequest("Captura los dólares que entregó el cliente");
      }
      pago.montoUsd = montoUsd;
    }
    if (p.metodoPago === "tarjeta") {
      if (p.terminalId) pago.terminalId = String(p.terminalId);
      // Crédito, débito y American Express se liquidan por separado: sin el
      // tipo, el corte no puede cuadrarse contra lo que deposita el banco.
      // Solo se acepta vacío en las ventas que venían encoladas sin conexión
      // desde una versión anterior, que quedan como "sin tipo identificado".
      if (p.tarjetaTipo != null) {
        if (!esTipoTarjeta(p.tarjetaTipo)) return badRequest("Tipo de tarjeta inválido");
        pago.tarjetaTipo = p.tarjetaTipo;
      }
    }
    if (p.metodoPago === "vales") {
      if (p.valeEmisorId) pago.valeEmisorId = String(p.valeEmisorId);
      // Solo los últimos 4 dígitos: el número completo nunca se guarda.
      if (p.valeUltimos4) pago.valeUltimos4 = String(p.valeUltimos4).replace(/\D/g, "").slice(-4);
    }
    pagos.push(pago);
  }

  const pagoEfectivo = pagos.find((p) => p.metodoPago === "efectivo");
  if (pagoEfectivo) {
    if (montoRecibido == null || montoRecibido < pagoEfectivo.monto) {
      return badRequest("El efectivo recibido debe ser mayor o igual a la parte pagada en efectivo");
    }
  } else if (montoRecibido != null) {
    return badRequest("No debes capturar efectivo recibido si no hay un pago en efectivo");
  }

  const pagoCredito = pagos.find((p) => p.metodoPago === "credito");
  const clienteIdBody = body?.clienteId ? String(body.clienteId) : null;
  if (pagoCredito && !clienteIdBody) {
    return badRequest("Selecciona al cliente para poder registrar la venta a crédito");
  }

  await connectDB();

  // Idempotencia: si esta misma operación ya se registró (la red se cortó
  // después de que el servidor la guardó, y el punto de venta la reintentó),
  // se devuelve la venta que ya existe en lugar de cobrarle dos veces al cliente.
  if (clienteOperacionId) {
    const yaRegistrada = await Venta.findOne({ clienteOperacionId });
    if (yaRegistrada) return NextResponse.json(yaRegistrada);
  }

  // La matriz vende de mostrador con su propia caja y descontando la existencia
  // del CEDIS; una sucursal descuenta su inventario.
  const ctx = await contextoPuntoVenta(session);
  if (!ctx) return forbidden();

  const sesionCaja = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" });
  if (!sesionCaja) return badRequest("Debes abrir la caja antes de registrar ventas");

  // --- Pagos en dólares ---
  // El tipo de cambio lo pone el servidor, nunca el navegador: si no, bastaría
  // con manipular la petición para llevarse la despensa con cinco dólares.
  const pagoDolares = pagos.find((p) => p.metodoPago === "efectivo_usd");
  let reglasUsd: ReturnType<typeof reglasDolaresDe> | null = null;
  if (pagoDolares) {
    const config = await obtenerConfiguracion();
    if (config.dolares?.aceptaPagos === false) {
      return badRequest("Esta tienda no está recibiendo pagos en dólares");
    }
    const tipoCambio = Number(config.tipoCambio);
    if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) {
      return badRequest("Matriz todavía no configura el tipo de cambio; no se puede cobrar en dólares");
    }
    const montoUsd = pagoDolares.montoUsd ?? 0;
    const valorEnPesos = montoUsd * tipoCambio;
    if (valorEnPesos - pagoDolares.monto < -0.01) {
      return badRequest(
        `Los ${montoUsd.toFixed(2)} USD equivalen a ${valorEnPesos.toFixed(2)} pesos, menos de los ` +
          `${pagoDolares.monto.toFixed(2)} que se le están aplicando a la venta`
      );
    }
    // Los topes se validan aquí y no solo en el navegador: el punto de venta los
    // avisa antes de cobrar, pero quien manda es el servidor.
    reglasUsd = reglasDolaresDe(config);
    pagoDolares.tipoCambio = tipoCambio;
  }

  // --- Terminal con la que se cobró la tarjeta ---
  const pagoTarjeta = pagos.find((p) => p.metodoPago === "tarjeta");
  if (pagoTarjeta) {
    const terminalesActivas = await TerminalPago.find({ sucursalId: ctx.sucursalId, activo: true })
      .select("alias")
      .lean();

    if (pagoTarjeta.terminalId) {
      const elegida = terminalesActivas.find((t) => String(t._id) === pagoTarjeta.terminalId);
      if (!elegida) return badRequest("La terminal seleccionada no existe o ya no está activa en esta tienda");
      pagoTarjeta.terminalAlias = elegida.alias;
    } else if (terminalesActivas.length > 0) {
      // Solo se exige cuando la tienda ya dio de alta sus terminales: las que
      // todavía no lo hacen siguen pudiendo cobrar con tarjeta sin trabarse.
      return badRequest("Indica con cuál terminal se cobró");
    }
  }

  // --- Emisor del vale de despensa ---
  // El nombre se sella en la venta para que el corte lo pueda desglosar aunque
  // después le cambien el nombre al emisor.
  const pagoVales = pagos.find((p) => p.metodoPago === "vales");
  if (pagoVales?.valeEmisorId) {
    const emisor = await EmisorValeModel.findById(pagoVales.valeEmisorId).select("nombre activo").lean();
    if (!emisor) return badRequest("El emisor de vales seleccionado no existe");
    if (!emisor.activo) return badRequest("Ese emisor de vales está desactivado");
    pagoVales.valeEmisorNombre = emisor.nombre;
  }

  // El cliente es opcional en una venta de contado, pero obligatorio (y validado
  // contra su límite y sus vencidos) cuando parte del pago va a crédito.
  const zonaHoraria = await zonaHorariaDeSucursal(ctx.sucursalId);

  const cliente = clienteIdBody ? await Cliente.findById(clienteIdBody) : null;
  if (clienteIdBody) {
    if (!cliente || String(cliente.sucursalId) !== String(ctx.sucursalId)) {
      return badRequest("El cliente no existe en esta sucursal");
    }
  }

  let vencimientoCredito: Date | null = null;
  if (pagoCredito && cliente) {
    const cuentasAbiertas = await CuentaPorCobrar.find({ clienteId: cliente._id, estado: "pendiente" }).lean();
    const resumen = resumenCredito(cliente, cuentasAbiertas as unknown as CuentaLike[], zonaHoraria);
    const motivo = motivoRechazoCredito(cliente, resumen, pagoCredito.monto);
    if (motivo) return conflict(motivo);
  }

  const productoIds = items.map((i) => i.productoId);
  const productos = await Producto.find({ _id: { $in: productoIds }, activo: true });
  const productoMap = new Map(productos.map((p) => [String(p._id), p]));

  const stockPorProducto = await stockPuntoVenta(ctx, productoIds);

  const reglas = await Promocion.find({ estado: "activa", sucursales: ctx.sucursalId }).lean();
  const agrupados = new Map<string, number>();
  for (const i of items) {
    if (!Number.isFinite(Number(i.cantidad)) || Number(i.cantidad) <= 0) return badRequest("Cantidad inválida.");
    agrupados.set(String(i.productoId), (agrupados.get(String(i.productoId)) ?? 0) + Number(i.cantidad));
  }
  const itemsUnicos = [...agrupados].map(([productoId, cantidad]) => ({ productoId, cantidad }));
  const precio = calcularPromociones(itemsUnicos.map((i) => {
    const p = productoMap.get(i.productoId);
    return { ...i, precio: p?.precioVenta ?? 0, unidad: p?.unidad ?? "pieza", categoria: p?.categoria, area: p?.area };
  }), JSON.parse(JSON.stringify(reglas)) as ReglaPromocion[], todayCorte(zonaHoraria));
  const lineaPrecio = new Map(precio.lineas.map((p) => [p.productoId, p]));
  const ventaItems = [];
  let total = 0;

  for (const item of itemsUnicos) {
    const producto = productoMap.get(item.productoId);
    const cantidad = Number(item.cantidad);
    if (!producto || !cantidad || cantidad <= 0) {
      return badRequest("Producto inválido o cantidad inválida en la venta");
    }

    if ((producto.unidad === "pieza" && !Number.isInteger(cantidad)) || Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 0.00001) return badRequest("Usa piezas enteras o kilos con hasta tres decimales.");

    // La existencia ya NO bloquea la venta. El producto está físicamente en el
    // mostrador y el cliente lo tiene en la mano: negarse a cobrarlo porque el
    // sistema trae el inventario desfasado pierde la venta y no arregla el
    // descuadre. Se cobra, la existencia queda en negativo (que es la señal de
    // que hay que ajustar) y compras recibe el aviso.

    const calculo = lineaPrecio.get(item.productoId)!;
    const subtotal = calculo.total;
    total += subtotal;
    ventaItems.push({
      productoId: producto._id,
      sku: producto.sku,
      nombreProducto: producto.nombre,
      unidad: producto.unidad,
      cantidad,
      precioUnitario: subtotal / cantidad,
      precioLista: producto.precioVenta,
      descuento: calculo.descuento,
      promocionId: calculo.promocionId || null,
      promocionNombre: calculo.promocionNombre,
      subtotal,
    });
  }

  if (total > 0 && pagos.length === 0) return badRequest("Debes capturar al menos una forma de pago");
  const sumaPagos = pagos.reduce((sum, p) => sum + p.monto, 0);
  if (Math.abs(sumaPagos - total) > 0.01) {
    return badRequest(`La suma de las formas de pago (${sumaPagos.toFixed(2)}) no coincide con el total (${total.toFixed(2)})`);
  }

  // Los topes de dólares se revisan hasta aquí porque el porcentaje se calcula
  // sobre el total real de la venta, que es el que arman los precios del
  // catálogo y no el que venga en la petición.
  if (pagoDolares && reglasUsd) {
    const rechazo = motivoRechazoDolares({
      reglas: reglasUsd,
      total,
      montoAplicado: pagoDolares.monto,
      montoUsd: pagoDolares.montoUsd ?? 0,
    });
    if (rechazo) return badRequest(rechazo);
  }

  const fechaVenta = new Date();
  if (pagoCredito && cliente) {
    vencimientoCredito = calcularVencimiento(fechaVenta, cliente.credito?.diasCredito ?? 30);
  }

  const ventas2 = await resolverVentas2ParaVenta({
    sucursalId: ctx.sucursalId,
    pagos,
    fecha: fechaVenta,
  });

  let venta;
  try {
    venta = await Venta.create({
      folio: await siguienteFolio(ventas2.esVentas2 ? "V2" : "VTA"),
      // Se omite si no viene: el índice único es parcial y no debe guardar null.
      ...(clienteOperacionId ? { clienteOperacionId } : {}),
      sucursalId: ctx.sucursalId,
      cajaSesionId: sesionCaja._id,
      usuarioId: session.userId,
      fecha: fechaVenta,
      corte: todayCorte(zonaHoraria),
      items: ventaItems,
      total: Number(total.toFixed(2)),
      subtotalSinDescuento: precio.bruto,
      descuento: precio.descuento,
      pagos,
      montoRecibido: pagoEfectivo ? montoRecibido : null,
      cambio: pagoEfectivo && montoRecibido != null ? Number((montoRecibido - pagoEfectivo.monto).toFixed(2)) : null,
      esVentas2: ventas2.esVentas2,
      ventas2ActivacionId: ventas2.activacionId,
      ventas2SecuenciaEfectivo: ventas2.secuenciaEfectivo,
      clienteId: cliente?._id ?? null,
      clienteNombre: cliente?.nombre ?? "",
      creditoMonto: pagoCredito?.monto ?? null,
      creditoFechaVencimiento: vencimientoCredito,
    });
  } catch (err) {
    // Dos reintentos de la misma venta que llegaron al mismo tiempo: el índice
    // único de `clienteOperacionId` deja pasar solo a uno. El otro devuelve esa
    // venta en lugar de un error, que para el cajero es lo mismo que ganar.
    const codigo = (err as { code?: number }).code;
    if (codigo === 11000 && clienteOperacionId) {
      const ganadora = await Venta.findOne({ clienteOperacionId });
      if (ganadora) return NextResponse.json(ganadora);
    }
    throw err;
  }

  if (pagoCredito && cliente && vencimientoCredito) {
    await CuentaPorCobrar.create({
      clienteId: cliente._id,
      sucursalId: ctx.sucursalId,
      ventaId: venta._id,
      folio: venta.folio,
      fecha: fechaVenta,
      fechaVencimiento: vencimientoCredito,
      diasCredito: cliente.credito?.diasCredito ?? 30,
      monto: pagoCredito.monto,
      saldo: pagoCredito.monto,
    });
    await recalcularSaldoCliente(cliente._id);
  }

  // Productos que esta venta deja en cero: se le avisan a compras en cuanto la
  // venta ya está guardada.
  const agotados: ProductoAgotado[] = [];

  for (const item of ventaItems) {
    await ajustarStockPuntoVenta(ctx, item.productoId, -item.cantidad);
    await MovimientoInventario.create({
      tipo: "salida_venta",
      productoId: item.productoId,
      nombreProducto: item.nombreProducto,
      ubicacion: ubicacionDeMovimiento(ctx),
      cantidad: item.cantidad,
      ventaId: venta._id,
      usuarioId: session.userId,
    });

    // La existencia previa ya se leyó arriba, así que la resultante se deduce
    // sin volver a consultar la base.
    const stockPrevio = stockPorProducto.get(String(item.productoId)) ?? 0;
    const stockResultante = stockPrevio - item.cantidad;
    if (stockResultante <= 0) {
      agotados.push({
        productoId: item.productoId,
        sku: item.sku,
        nombreProducto: item.nombreProducto,
        unidad: item.unidad,
        cantidadVendida: item.cantidad,
        stockResultante,
        // Se vendió más de lo que el sistema decía tener: no es solo "se acabó",
        // es que el inventario ya venía descuadrado y hay que ajustarlo.
        vendidoSinExistencia: stockPrevio < item.cantidad,
      });
    }
  }

  // El aviso a compras nunca puede tumbar una venta ya cobrada: si Evolution API
  // está caída o la alerta falla, la venta se devuelve igual y el faltante se ve
  // de todos modos en el tablero de matriz.
  try {
    await alertarInventarioEnCero({
      ctx,
      agotados,
      ventaId: venta._id,
      ventaFolio: venta.folio,
    });
  } catch (err) {
    console.error("No se pudo registrar la alerta de inventario en cero", err);
  }

  return NextResponse.json(venta, { status: 201 });
}
