import { escaparHTML, imprimirTicket } from "@/lib/print";
import { formatFechaLarga, formatHora } from "@/lib/zonasHorarias";

// Ticket de devolución para la impresora térmica del mostrador.
//
// Se imprimen dos copias de un tirón: la del cliente (su comprobante de que
// entregó la mercancía y de cuánto se le reembolsó) y la del turno, que se
// guarda en el cajón y es la que se coteja contra el corte al cerrar. Sin esa
// segunda copia, el faltante de efectivo del corte no tiene respaldo en papel.

export type ItemTicketDevolucion = {
  nombreProducto: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  subtotal: number;
};

export type DevolucionTicket = {
  folio: string;
  ventaFolio: string;
  fecha?: string | Date | null;
  /** Día de corte (YYYY-MM-DD) al que queda amarrada la devolución. */
  corte?: string | null;
  items: ItemTicketDevolucion[];
  total: number;
  montoCredito?: number;
  montoEfectivo?: number;
  estado?: string;
  motivo?: string;
  clienteNombre?: string;
};

function pesos(valor: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
}

function fila(concepto: string, importe: string, clase = "") {
  return `<div class="fila ${clase}"><span class="concepto">${concepto}</span><span>${importe}</span></div>`;
}

function cantidadTexto(item: ItemTicketDevolucion) {
  const cantidad = item.unidad === "kg" ? item.cantidad.toFixed(3) : String(item.cantidad);
  return `${cantidad} ${item.unidad}`;
}

/**
 * Una copia del comprobante. `copia` la identifica ("CLIENTE" / "TURNO"); la del
 * turno lleva línea de firma porque es la que respalda la salida de efectivo.
 */
function copiaHTML(
  devolucion: DevolucionTicket,
  {
    sucursalNombre,
    zonaHoraria,
    cajero,
    copia,
  }: { sucursalNombre: string; zonaHoraria: string; cajero: string; copia: "CLIENTE" | "TURNO" }
) {
  const fecha = devolucion.fecha ? new Date(devolucion.fecha) : new Date();
  const montoEfectivo = devolucion.montoEfectivo ?? 0;
  const montoCredito = devolucion.montoCredito ?? 0;

  const datos = [
    fila("Folio", escaparHTML(devolucion.folio)),
    fila("Venta", escaparHTML(devolucion.ventaFolio)),
    fila("Fecha", `${formatFechaLarga(fecha, zonaHoraria)} ${formatHora(fecha, zonaHoraria)}`),
    // El día de corte va impreso: es la liga entre este papel y el arqueo.
    devolucion.corte ? fila("Corte", escaparHTML(devolucion.corte)) : "",
    cajero ? fila("Atendió", escaparHTML(cajero)) : "",
    devolucion.clienteNombre ? fila("Cliente", escaparHTML(devolucion.clienteNombre)) : "",
  ].join("");

  const items = devolucion.items
    .map((i) =>
      [
        `<div>${escaparHTML(i.nombreProducto)}</div>`,
        fila(`<span class="tenue">${cantidadTexto(i)} x ${pesos(i.precioUnitario)}</span>`, pesos(i.subtotal)),
      ].join("")
    )
    .join("");

  const desglose = [
    montoCredito > 0 ? fila("Abonado a su cuenta", pesos(montoCredito)) : "",
    montoEfectivo > 0
      ? fila(
          devolucion.estado === "pendiente" ? "Efectivo POR PAGAR" : "Reembolso en efectivo",
          pesos(montoEfectivo)
        )
      : "",
  ].join("");

  const pendiente =
    devolucion.estado === "pendiente"
      ? `<div class="sep"></div><div class="centro">PENDIENTE DE PAGO<br /><span class="tenue">El corte del dia ya estaba cerrado. Pasa por tu reembolso con la caja abierta.</span></div>`
      : "";

  // Solo la copia del turno pide firma: es el respaldo de que el dinero salió.
  const firma =
    copia === "TURNO"
      ? `
        <div class="firma">
          <div class="linea"></div>
          <div class="centro tenue">Firma de quien recibe la mercancia</div>
        </div>
        <div class="firma">
          <div class="linea"></div>
          <div class="centro tenue">Autorizo (encargado de turno)</div>
        </div>
      `
      : "";

  return `
    <div class="corte">
      <div class="centro">
        <div class="titulo">MERCADOS TITOS</div>
        <div class="sucursal">${escaparHTML(sucursalNombre || "Sucursal")}</div>
      </div>
      <div class="copia">DEVOLUCION &middot; COPIA ${copia}</div>
      <div class="sep"></div>
      ${datos}
      <div class="sep"></div>
      ${items}
      <div class="sep"></div>
      ${fila("TOTAL DEVUELTO", pesos(devolucion.total), "fuerte")}
      ${desglose}
      ${devolucion.motivo ? `<div class="sep"></div>${fila("Motivo", escaparHTML(devolucion.motivo))}` : ""}
      ${pendiente}
      ${firma}
      <div class="sep"></div>
      <div class="centro pie">
        ${
          copia === "CLIENTE"
            ? "Conserva este comprobante para cualquier aclaracion."
            : "Guardar en el cajon: respalda la salida de efectivo del corte."
        }
      </div>
    </div>
  `;
}

export function ticketDevolucionHTML(
  devolucion: DevolucionTicket,
  {
    sucursalNombre = "",
    zonaHoraria,
    cajero = "",
  }: { sucursalNombre?: string; zonaHoraria: string; cajero?: string }
) {
  const opciones = { sucursalNombre, zonaHoraria, cajero };
  return [
    copiaHTML(devolucion, { ...opciones, copia: "CLIENTE" }),
    copiaHTML(devolucion, { ...opciones, copia: "TURNO" }),
  ].join("");
}

export function imprimirTicketDevolucion(
  devolucion: DevolucionTicket,
  opciones: { sucursalNombre?: string; zonaHoraria: string; cajero?: string }
) {
  imprimirTicket(`Devolución ${devolucion.folio}`, ticketDevolucionHTML(devolucion, opciones));
}
