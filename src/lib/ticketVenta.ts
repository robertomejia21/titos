import { escaparHTML, imprimirTicket } from "@/lib/print";
import { formatFechaLarga, formatHora } from "@/lib/zonasHorarias";
import { ETIQUETA_TIPO_TARJETA_CORTA, esTipoTarjeta } from "@/lib/tarjetas";
import { LOGO_TICKET } from "@/lib/logoTicket";

// Ticket de venta para la impresora térmica del mostrador. Vive aparte del
// punto de venta para que el historial de ventas pueda reimprimir exactamente
// el mismo documento sin duplicar el armado.
//
// Las ventas con tarjeta salen en DOS copias del mismo tiro: la del cliente y
// la del comercio, que es la que se firma y se guarda en el cajón. El banco pide
// el pagaré firmado para defender un contracargo, así que esa copia no puede
// depender de que alguien se acuerde de reimprimir el ticket.

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  efectivo_usd: "Efectivo USD",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales despensa",
  credito: "Crédito",
};

export type PagoTicket = {
  metodoPago: string;
  monto: number;
  montoUsd?: number | null;
  tipoCambio?: number | null;
  terminalAlias?: string;
  autorizacion?: string;
  tarjetaTipo?: string | null;
  valeEmisorNombre?: string;
  valeUltimos4?: string;
};

export type ItemTicket = {
  nombreProducto: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  subtotal: number;
  precioLista?: number;
  descuento?: number;
  promocionNombre?: string;
};

export type VentaTicket = {
  folio: string;
  fecha?: string | Date | null;
  items: ItemTicket[];
  total: number;
  // Desglose fiscal. Van opcionales porque las ventas registradas antes de que
  // el mostrador cobrara impuestos no los traen, y su ticket debe reimprimirse
  // igual que siempre en vez de mostrar ceros que confundan.
  baseGravable?: number;
  totalIeps?: number;
  totalIva?: number;
  pagos: PagoTicket[];
  montoRecibido?: number | null;
  cambio?: number | null;
  /**
   * Ventas que cayeron en el protocolo de Notas de venta (/matriz/notas-de-venta).
   * Es lo único que marca el asterisco del encabezado.
   */
  esVentas2?: boolean;
  clienteNombre?: string;
  creditoMonto?: number | null;
};

function pesos(valor: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

function fila(concepto: string, importe: string, clase = "") {
  return `<div class="fila ${clase}"><span class="concepto">${concepto}</span><span>${importe}</span></div>`;
}

/** Cantidad legible: los kilos llevan decimales, las piezas no. */
function cantidadTexto(item: ItemTicket) {
  const cantidad = item.unidad === "kg" ? item.cantidad.toFixed(3) : String(item.cantidad);
  return `${cantidad} ${item.unidad}`;
}

/**
 * Encabezado del ticket. El asterisco junto al nombre de la sucursal distingue
 * las ventas que entraron por el protocolo de Notas de venta: es la marca que
 * pidió matriz para separarlas de un vistazo sin cambiar nada más del formato.
 */
function encabezado(venta: VentaTicket, sucursalNombre: string) {
  const nombre = `${sucursalNombre || "Sucursal"}${venta.esVentas2 ? " *" : ""}`;
  return `
    <div class="centro">
      <img class="logo" src="${LOGO_TICKET}" alt="MERCADOS TITOS" />
      <div class="sucursal">${escaparHTML(nombre)}</div>
    </div>
  `;
}

function detallePago(pago: PagoTicket) {
  const base = ETIQUETA_METODO[pago.metodoPago] ?? pago.metodoPago;
  // El tipo va pegado al renglón y no en una línea aparte: el ticket térmico
  // mide 32 caracteres y una línea de más es papel de más en cada venta.
  const etiqueta =
    pago.metodoPago === "tarjeta" && esTipoTarjeta(pago.tarjetaTipo)
      ? `${base} ${ETIQUETA_TIPO_TARJETA_CORTA[pago.tarjetaTipo]}`
      : base;
  const lineas = [fila(escaparHTML(etiqueta), pesos(pago.monto))];

  if (pago.metodoPago === "efectivo_usd" && pago.montoUsd) {
    const tipoCambio = pago.tipoCambio ?? 0;
    lineas.push(
      fila(
        `<span class="tenue">Recibido ${pago.montoUsd.toFixed(2)} USD${
          tipoCambio ? ` a ${pesos(tipoCambio)}` : ""
        }</span>`,
        ""
      )
    );
    // El cambio de un pago en dólares se devuelve en pesos.
    const sobrante = Number((pago.montoUsd * tipoCambio - pago.monto).toFixed(2));
    if (sobrante > 0) lineas.push(fila('<span class="tenue">Cambio en pesos</span>', pesos(sobrante)));
  }

  if (pago.metodoPago === "vales" && (pago.valeEmisorNombre || pago.valeUltimos4)) {
    const detalle = [pago.valeEmisorNombre, pago.valeUltimos4 ? `****${pago.valeUltimos4}` : ""]
      .filter(Boolean)
      .join(" ");
    lineas.push(fila(`<span class="tenue">${escaparHTML(detalle)}</span>`, ""));
  }

  if (pago.metodoPago === "tarjeta" && pago.terminalAlias) {
    lineas.push(fila(`<span class="tenue">Terminal ${escaparHTML(pago.terminalAlias)}</span>`, ""));
  }
  if (pago.metodoPago === "tarjeta" && pago.autorizacion) {
    lineas.push(fila(`<span class="tenue">Autorización capturada: ${escaparHTML(pago.autorizacion)}</span>`, ""));
  }

  return lineas.join("");
}

/** Cada copia se identifica en el papel; sin marca, las dos se ven iguales. */
type CopiaTicket = "CLIENTE" | "COMERCIO";

function cuerpoTicket(
  venta: VentaTicket,
  {
    sucursalNombre = "",
    zonaHoraria,
    cajero = "",
    copia = null,
  }: { sucursalNombre?: string; zonaHoraria: string; cajero?: string; copia?: CopiaTicket | null }
) {
  const fecha = venta.fecha ? new Date(venta.fecha) : new Date();
  const hayEfectivo = venta.pagos.some((p) => p.metodoPago === "efectivo");

  const datos = [
    fila("Folio", escaparHTML(venta.folio)),
    fila("Fecha", `${formatFechaLarga(fecha, zonaHoraria)} ${formatHora(fecha, zonaHoraria)}`),
    cajero ? fila("Atendió", escaparHTML(cajero)) : "",
    venta.clienteNombre ? fila("Cliente", escaparHTML(venta.clienteNombre)) : "",
  ].join("");

  const items = venta.items
    .map((i) =>
      [
        `<div>${escaparHTML(i.nombreProducto)}</div>`,
        fila(
          `<span class="tenue">${cantidadTexto(i)} x ${pesos(i.precioLista ?? i.precioUnitario)}</span>`,
          pesos(i.subtotal)
        ),
        i.descuento ? fila(`Descuento: ${escaparHTML(i.promocionNombre || "Promoción")}`, `−${pesos(i.descuento)}`) : "",
      ].join("")
    )
    .join("");

  const efectivo = hayEfectivo
    ? [
        fila("Recibido", pesos(venta.montoRecibido ?? 0)),
        fila("Cambio", pesos(venta.cambio ?? 0)),
      ].join("")
    : "";

  const credito = venta.creditoMonto
    ? `<div class="sep"></div><div class="centro">Venta a crédito por ${pesos(venta.creditoMonto)}</div>`
    : "";

  // La copia del comercio lleva la firma del tarjetahabiente: es el pagaré con
  // el que el banco resuelve una aclaración o un contracargo.
  const firma =
    copia === "COMERCIO"
      ? `
        <div class="firma">
          <div class="linea"></div>
          <div class="centro tenue">Firma del tarjetahabiente</div>
        </div>
      `
      : "";

  const pie =
    copia === "COMERCIO"
      ? "Copia del comercio. Guardar firmada en el cajon."
      : "¡Gracias por su compra!<br />Presenta este ticket para cualquier aclaración.";

  return `
    <div class="corte">
      ${encabezado(venta, sucursalNombre)}
      ${copia ? `<div class="copia">COPIA ${copia}</div>` : ""}
      <div class="sep"></div>
      ${datos}
      <div class="sep"></div>
      ${items}
      <div class="sep"></div>
      ${(venta.totalIva ?? 0) > 0 || (venta.totalIeps ?? 0) > 0
        ? [
            fila("Subtotal", pesos(venta.baseGravable ?? 0)),
            (venta.totalIeps ?? 0) > 0 ? fila("IEPS", pesos(venta.totalIeps ?? 0)) : "",
            (venta.totalIva ?? 0) > 0 ? fila("IVA", pesos(venta.totalIva ?? 0)) : "",
          ].join("")
        : ""}
      ${fila("TOTAL", pesos(venta.total), "fuerte")}
      <div class="sep"></div>
      ${venta.pagos.map(detallePago).join("")}
      ${efectivo}
      ${credito}
      ${firma}
      <div class="sep"></div>
      <div class="centro pie">${pie}</div>
    </div>
  `;
}

export function ticketVentaHTML(
  venta: VentaTicket,
  opciones: { sucursalNombre?: string; zonaHoraria: string; cajero?: string }
) {
  // Solo el cobro con tarjeta necesita las dos copias. Duplicar todos los
  // tickets sería tirar el doble de papel en la venta de contado, que es la
  // mayoría.
  const conTarjeta = venta.pagos.some((p) => p.metodoPago === "tarjeta");
  if (!conTarjeta) return cuerpoTicket(venta, opciones);

  return [
    cuerpoTicket(venta, { ...opciones, copia: "CLIENTE" }),
    cuerpoTicket(venta, { ...opciones, copia: "COMERCIO" }),
  ].join("");
}

export function imprimirTicketVenta(
  venta: VentaTicket,
  opciones: { sucursalNombre?: string; zonaHoraria: string; cajero?: string },
  ventanaPreparada?: Window | null
) {
  return imprimirTicket(`Ticket ${venta.folio}`, ticketVentaHTML(venta, opciones), ventanaPreparada);
}

/**
 * Ticket de prueba para revisar la impresora térmica: logo, regla de 32 columnas
 * (si se corta un borde, el ancho del papel o los márgenes del driver están mal),
 * dígitos, kilos con tres decimales y un total. No es una venta: no toca la base.
 */
export function ticketPruebaHTML(opciones: { sucursalNombre?: string; zonaHoraria: string }) {
  const venta: VentaTicket = {
    folio: "PRUEBA",
    fecha: new Date(),
    items: [
      { nombreProducto: "AGUAYON (prueba)", cantidad: 1.256, unidad: "kg", precioUnitario: 349, subtotal: 438.34 },
      { nombreProducto: "PRODUCTO EN PIEZA (prueba)", cantidad: 2, unidad: "pieza", precioUnitario: 15.5, subtotal: 31 },
    ],
    total: 469.34,
    pagos: [{ metodoPago: "efectivo", monto: 469.34 }],
    montoRecibido: 500,
    cambio: 30.66,
  };
  const regla = "12345678901234567890123456789012";
  return `
    <div class="centro fuerte">*** TICKET DE PRUEBA ***</div>
    <div class="centro tenue">No es una venta ni cobra dinero</div>
    <div class="centro tenue">${regla}</div>
    <div class="centro tenue">0123456789 &nbsp; 5 6 8 3 &nbsp; 0.123 kg</div>
    ${ticketVentaHTML(venta, { sucursalNombre: opciones.sucursalNombre || "Prueba de impresión", zonaHoraria: opciones.zonaHoraria })}
    <div class="centro tenue">${regla}</div>
    <div class="centro tenue">Si ves el logo, la regla completa y el</div>
    <div class="centro tenue">corte limpio, la impresora está lista.</div>
  `;
}

export function imprimirTicketPrueba(opciones: { sucursalNombre?: string; zonaHoraria: string }) {
  return imprimirTicket("Ticket de prueba", ticketPruebaHTML(opciones));
}
