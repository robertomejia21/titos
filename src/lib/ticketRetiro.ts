import { escaparHTML, imprimirTicket } from "@/lib/print";
import { formatFechaLarga, formatHora } from "@/lib/zonasHorarias";
import { LOGO_TICKET } from "@/lib/logoTicket";
import { importeConLetra } from "@/lib/importeConLetra";

// Comprobante de retiro de efectivo para la impresora térmica de la caja.
//
// Sale en DOS copias del mismo tiro: la de CAJA, que se queda en el cajón y se
// entrega con el corte, y la del GERENTE, que acompaña al dinero hasta la caja
// fuerte o el depósito. Las dos llevan la firma de quien entrega (cajero) y de
// quien recibe (gerente): si el corte no cuadra, es la evidencia de que el
// dinero cambió de manos y por cuánto.

export type RetiroTicket = {
  folio: string;
  fecha: string | Date;
  monto: number;
  moneda: "MXN" | "USD";
  motivo: string;
  origen?: "manual" | "limite";
  usuarioNombre?: string;
  autorizadoPorNombre?: string;
  efectivoAntes?: number | null;
  efectivoDespues?: number | null;
  desglose?: { denominacion: number; cantidad: number }[];
};

type Copia = "CAJA" | "GERENTE";

function dinero(valor: number, moneda: "MXN" | "USD") {
  const texto = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor);
  return moneda === "USD" ? `${texto} USD` : texto;
}

function fila(concepto: string, importe: string, clase = "") {
  return `<div class="fila ${clase}"><span class="concepto">${concepto}</span><span>${importe}</span></div>`;
}

function etiquetaDenominacion(d: number) {
  const tipo = d >= 20 ? "Billete" : "Moneda";
  const valor = d < 1 ? "50¢" : `$${d.toLocaleString("es-MX")}`;
  return `${tipo} ${valor}`;
}

function cuerpo(
  retiro: RetiroTicket,
  copia: Copia,
  { sucursalNombre, zonaHoraria, cajero, numeroCaja }: { sucursalNombre: string; zonaHoraria: string; cajero: string; numeroCaja: number | null }
) {
  const fecha = new Date(retiro.fecha);
  const moneda = retiro.moneda;
  const titulo = retiro.origen === "limite" ? "RETIRO PARCIAL DE EFECTIVO" : "RETIRO DE EFECTIVO";
  const entrega = cajero || retiro.usuarioNombre || "";
  const recibe = retiro.autorizadoPorNombre || "";

  const desglose = (retiro.desglose ?? []).filter((r) => r.cantidad > 0);
  const bloqueDesglose = desglose.length
    ? `
      <div class="sep"></div>
      <div class="tenue">Desglose entregado</div>
      ${desglose
        .map((r) =>
          fila(`${r.cantidad} x ${etiquetaDenominacion(r.denominacion)}`, dinero(r.denominacion * r.cantidad, moneda))
        )
        .join("")}
    `
    : "";

  const saldo =
    retiro.efectivoAntes != null && retiro.efectivoDespues != null
      ? `
        <div class="sep"></div>
        ${fila("Efectivo antes", dinero(retiro.efectivoAntes, moneda))}
        ${fila("Retiro", `−${dinero(retiro.monto, moneda)}`)}
        ${fila("Queda en caja", dinero(retiro.efectivoDespues, moneda))}
      `
      : "";

  return `
    <div class="corte">
      <div class="centro">
        <img class="logo" src="${LOGO_TICKET}" alt="MERCADOS TITOS" />
        <div class="sucursal">${escaparHTML(sucursalNombre || "Sucursal")}</div>
      </div>
      <div class="centro titulo">${titulo}</div>
      <div class="copia">COPIA ${copia}</div>
      <div class="sep"></div>
      ${fila("Folio", escaparHTML(retiro.folio))}
      ${numeroCaja ? fila("Caja", String(numeroCaja)) : ""}
      ${fila("Fecha", `${formatFechaLarga(fecha, zonaHoraria)} ${formatHora(fecha, zonaHoraria)}`)}
      ${entrega ? fila("Cajero", escaparHTML(entrega)) : ""}
      ${recibe ? fila("Autorizó", escaparHTML(recibe)) : ""}
      ${fila("Motivo", escaparHTML(retiro.motivo))}
      <div class="sep"></div>
      ${fila("IMPORTE", dinero(retiro.monto, moneda), "fuerte")}
      ${moneda === "MXN" ? `<div class="tenue">(${importeConLetra(retiro.monto)})</div>` : ""}
      ${bloqueDesglose}
      ${saldo}
      <div class="firma" style="margin-top:28px">
        <div class="linea"></div>
        <div class="centro tenue">Entrega: ${escaparHTML(entrega || "Cajero")}</div>
      </div>
      <div class="firma" style="margin-top:28px">
        <div class="linea"></div>
        <div class="centro tenue">Recibe: ${escaparHTML(recibe || "Gerente de tienda")}</div>
      </div>
      <div class="sep"></div>
      <div class="centro pie">${
        copia === "CAJA"
          ? "Copia de caja. Guardar firmada y entregar con el corte."
          : "Copia del gerente. Acompaña al efectivo hasta su resguardo."
      }</div>
    </div>
  `;
}

export function ticketRetiroHTML(
  retiro: RetiroTicket,
  opciones: { sucursalNombre?: string; zonaHoraria: string; cajero?: string; numeroCaja?: number | null }
) {
  const o = { sucursalNombre: opciones.sucursalNombre ?? "", zonaHoraria: opciones.zonaHoraria, cajero: opciones.cajero ?? "", numeroCaja: opciones.numeroCaja ?? null };
  return [cuerpo(retiro, "CAJA", o), cuerpo(retiro, "GERENTE", o)].join("");
}

export function imprimirTicketRetiro(
  retiro: RetiroTicket,
  opciones: { sucursalNombre?: string; zonaHoraria: string; cajero?: string; numeroCaja?: number | null },
  ventanaPreparada?: Window | null
) {
  return imprimirTicket(`Retiro ${retiro.folio}`, ticketRetiroHTML(retiro, opciones), ventanaPreparada);
}
