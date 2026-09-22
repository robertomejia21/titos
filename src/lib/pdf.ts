import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { montoLineaPedido } from "@/lib/montoPedido";
import { formatFechaLarga, formatHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

const PAGE_WIDTH = 595.28; // A4 portrait, en puntos
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

const VERDE_OSCURO: [number, number, number] = [0.059, 0.29, 0.125]; // #0f4a20 (titos-green-900)
const VERDE_CLARO: [number, number, number] = [0.89, 0.953, 0.902]; // #e3f3e6 (titos-green-100)
const GRIS_TEXTO: [number, number, number] = [0.33, 0.33, 0.35];
const GRIS_CLARO: [number, number, number] = [0.6, 0.62, 0.6];
const ZEBRA: [number, number, number] = [0.965, 0.968, 0.965];
const BLANCO: [number, number, number] = [1, 1, 1];
const VERDE_TEXTO_CLARO: [number, number, number] = [0.85, 0.92, 0.87];

const HEADER_HEIGHT = 72;
const FOOTER_HEIGHT = 34;
const CONTENT_TOP = PAGE_HEIGHT - HEADER_HEIGHT - 24;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

// El PDF se genera en el servidor (UTC en producción), así que el sello de
// generación se fija explícitamente en la zona de la operación.
function formatFechaHoraGeneracion(fecha: Date, zona: string = ZONA_HORARIA_DEFAULT) {
  return `Generado el ${formatFechaLarga(fecha, zona)} · ${formatHora(fecha, zona)}`;
}

// Se lee una sola vez por instancia del servidor y se reutiliza en cada PDF.
let logoBytesPromise: Promise<Buffer> | null = null;
function cargarLogoBytes() {
  logoBytesPromise ??= readFile(path.join(process.cwd(), "public", "media", "logo.png"));
  return logoBytesPromise;
}

type Columna = { header: string; width: number; align?: "left" | "right" };
type Tabla = { titulo?: string; columnas: Columna[]; filas: string[][] };

/**
 * Bloque fiscal de un CFDI timbrado: el QR de verificación del SAT junto a los
 * sellos y la cadena original. Sin esto el PDF no es representación impresa
 * válida, solo un resumen bonito.
 */
type SelloFiscal = {
  /** PNG del QR en base64, tal como lo devuelve el PAC. */
  qrBase64?: string;
  datos: { etiqueta: string; valor: string }[];
  /** Cadena original del complemento de certificación. Va a renglón suelto. */
  cadenaOriginal?: string;
  selloCFDI?: string;
  selloSAT?: string;
};

type TablaPDFOpciones = {
  titulo: string;
  subtitulo: string[];
  tabla: Tabla;
  totalLabel: string;
  totalValor: string;
  tablaExtra?: Tabla;
  selloFiscal?: SelloFiscal;
};

export { formatMoney };

/** Recorta un texto para que quepa en `ancho` puntos, con elipsis. */
function truncarAlAncho(texto: string, ancho: number, size: number, font: PDFFont) {
  if (font.widthOfTextAtSize(texto, size) <= ancho) return texto;
  let corte = texto;
  while (corte.length > 1 && font.widthOfTextAtSize(`${corte}…`, size) > ancho) {
    corte = corte.slice(0, -1);
  }
  return `${corte}…`;
}

/**
 * Parte una cadena larga en renglones que quepan en `ancho`. Corta por
 * caracteres y no por palabras a propósito: los sellos y la cadena original son
 * base64 y hashes, no prosa.
 */
function partirEnRenglones(texto: string, ancho: number, size: number, font: PDFFont) {
  const renglones: string[] = [];
  let actual = "";
  for (const caracter of texto) {
    const tentativa = actual + caracter;
    if (font.widthOfTextAtSize(tentativa, size) > ancho) {
      renglones.push(actual);
      actual = caracter;
    } else {
      actual = tentativa;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

export async function generarTablaPDF(opciones: TablaPDFOpciones): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdf.embedPng(await cargarLogoBytes());
  const logoDims = logoImage.scaleToFit(110, 40);

  const generadoEl = formatFechaHoraGeneracion(new Date());

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = CONTENT_TOP;

  function dibujarEncabezadoMarca(pagina: PDFPage, esPrimeraPagina: boolean) {
    pagina.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_HEIGHT, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: rgb(...VERDE_OSCURO) });

    pagina.drawImage(logoImage, {
      x: MARGIN,
      y: PAGE_HEIGHT - HEADER_HEIGHT + (HEADER_HEIGHT - logoDims.height) / 2,
      width: logoDims.width,
      height: logoDims.height,
    });

    const tituloX = MARGIN + logoDims.width + 18;
    pagina.drawText(opciones.titulo, {
      x: tituloX,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - 4,
      size: 15,
      font: fontBold,
      color: rgb(...BLANCO),
    });
    pagina.drawText(esPrimeraPagina ? "Sistema Titos" : "Continuación", {
      x: tituloX,
      y: PAGE_HEIGHT - HEADER_HEIGHT / 2 - 18,
      size: 8,
      font: fontRegular,
      color: rgb(...VERDE_TEXTO_CLARO),
    });

    const anchoGenerado = fontRegular.widthOfTextAtSize(generadoEl, 8);
    pagina.drawText(generadoEl, {
      x: PAGE_WIDTH - MARGIN - anchoGenerado,
      y: PAGE_HEIGHT - HEADER_HEIGHT + 14,
      size: 8,
      font: fontRegular,
      color: rgb(...VERDE_TEXTO_CLARO),
    });
  }

  dibujarEncabezadoMarca(page, true);

  function nuevaPagina() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    dibujarEncabezadoMarca(page, false);
    y = CONTENT_TOP;
  }

  function escribir(
    texto: string,
    opts: { size?: number; font?: PDFFont; x?: number; color?: [number, number, number] } = {}
  ) {
    const { size = 10, font = fontRegular, x = MARGIN, color = GRIS_TEXTO } = opts;
    page.drawText(texto, { x, y, size, font, color: rgb(...color) });
  }

  function linea(color: [number, number, number] = [0.85, 0.85, 0.85], grosor = 0.6) {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: grosor,
      color: rgb(...color),
    });
  }

  function encabezadosTabla(tabla: Tabla) {
    if (tabla.titulo) {
      escribir(tabla.titulo, { size: 12, font: fontBold, color: VERDE_OSCURO });
      y -= 18;
    }

    page.drawRectangle({
      x: MARGIN - 4,
      y: y - 4,
      width: PAGE_WIDTH - MARGIN * 2 + 8,
      height: 18,
      color: rgb(...VERDE_CLARO),
    });

    let x = MARGIN;
    for (const col of tabla.columnas) {
      escribir(col.header, { size: 9, font: fontBold, x, color: VERDE_OSCURO });
      x += col.width;
    }
    y -= 20;
  }

  function dibujarTabla(tabla: Tabla) {
    encabezadosTabla(tabla);

    tabla.filas.forEach((fila, i) => {
      if (y < CONTENT_BOTTOM + 20) {
        nuevaPagina();
        encabezadosTabla(tabla);
      }

      if (i % 2 === 1) {
        page.drawRectangle({
          x: MARGIN - 4,
          y: y - 4,
          width: PAGE_WIDTH - MARGIN * 2 + 8,
          height: 15,
          color: rgb(...ZEBRA),
        });
      }

      let x = MARGIN;
      fila.forEach((celda, ci) => {
        const col = tabla.columnas[ci];
        const ancho = fontRegular.widthOfTextAtSize(celda, 9);
        const textoX = col.align === "right" ? x + col.width - ancho : x;
        escribir(celda, { size: 9, x: textoX });
        x += col.width;
      });
      y -= 15;
    });
    y -= 8;
  }

  for (const l of opciones.subtitulo) {
    escribir(l, { size: 10, color: GRIS_TEXTO });
    y -= 13;
  }
  y -= 10;

  dibujarTabla(opciones.tabla);

  if (y < CONTENT_BOTTOM + 30) nuevaPagina();

  linea(VERDE_OSCURO, 1);
  y -= 20;
  const anchoCajaTotal = 190;
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - anchoCajaTotal,
    y: y - 8,
    width: anchoCajaTotal,
    height: 24,
    color: rgb(...VERDE_CLARO),
  });
  escribir(opciones.totalLabel, {
    size: 11,
    font: fontBold,
    x: PAGE_WIDTH - MARGIN - anchoCajaTotal + 12,
    color: VERDE_OSCURO,
  });
  const anchoTotalValor = fontBold.widthOfTextAtSize(opciones.totalValor, 11);
  escribir(opciones.totalValor, {
    size: 11,
    font: fontBold,
    x: PAGE_WIDTH - MARGIN - 12 - anchoTotalValor,
    color: VERDE_OSCURO,
  });
  y -= 28;

  if (opciones.tablaExtra && opciones.tablaExtra.filas.length > 0) {
    if (y < CONTENT_BOTTOM + 40) nuevaPagina();
    dibujarTabla(opciones.tablaExtra);
  }

  // Bloque fiscal del CFDI timbrado: QR de verificación del SAT a la izquierda,
  // UUID y sellos a su derecha, cadena original abajo. El orden no es estético:
  // es el que traen las representaciones impresas que la gente ya conoce.
  const sello = opciones.selloFiscal;
  if (sello) {
    if (y < CONTENT_BOTTOM + 150) nuevaPagina();
    y -= 6;
    escribir("Comprobante Fiscal Digital por Internet (CFDI)", { size: 11, font: fontBold, color: VERDE_OSCURO });
    y -= 6;
    linea(VERDE_OSCURO, 1);
    y -= 14;

    const topeBloque = y;
    let qrAncho = 0;
    if (sello.qrBase64) {
      try {
        const qr = await pdf.embedPng(Buffer.from(sello.qrBase64, "base64"));
        const dims = qr.scaleToFit(96, 96);
        page.drawImage(qr, { x: MARGIN, y: topeBloque - dims.height + 10, width: dims.width, height: dims.height });
        qrAncho = dims.width + 14;
      } catch {
        // Un QR ilegible no debe impedir imprimir la factura: el XML sigue
        // siendo el documento válido y el UUID va escrito abajo.
        escribir("(no se pudo dibujar el código QR)", { size: 7.5, color: GRIS_CLARO });
      }
    }

    const xDatos = MARGIN + qrAncho;
    for (const dato of sello.datos) {
      escribir(dato.etiqueta, { size: 7.5, font: fontBold, x: xDatos, color: GRIS_TEXTO });
      y -= 9;
      escribir(truncarAlAncho(dato.valor, PAGE_WIDTH - MARGIN - xDatos, 8, fontRegular), {
        size: 8,
        x: xDatos,
        color: GRIS_TEXTO,
      });
      y -= 13;
    }

    y = Math.min(y, topeBloque - 100) - 6;

    for (const [etiqueta, valor] of [
      ["Sello digital del CFDI", sello.selloCFDI],
      ["Sello digital del SAT", sello.selloSAT],
      ["Cadena original del complemento de certificación digital del SAT", sello.cadenaOriginal],
    ] as [string, string | undefined][]) {
      if (!valor) continue;
      if (y < CONTENT_BOTTOM + 30) nuevaPagina();
      escribir(etiqueta, { size: 7.5, font: fontBold, color: GRIS_TEXTO });
      y -= 9;
      for (const renglon of partirEnRenglones(valor, PAGE_WIDTH - MARGIN * 2, 6.5, fontRegular)) {
        if (y < CONTENT_BOTTOM + 14) nuevaPagina();
        escribir(renglon, { size: 6.5, color: GRIS_CLARO });
        y -= 8;
      }
      y -= 6;
    }

    if (y < CONTENT_BOTTOM + 20) nuevaPagina();
    escribir("Este documento es una representación impresa de un CFDI.", {
      size: 7.5,
      font: fontBold,
      color: GRIS_TEXTO,
    });
    y -= 12;
  }

  const paginas = pdf.getPages();
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: MARGIN, y: MARGIN + 16 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 16 },
      thickness: 0.6,
      color: rgb(...GRIS_CLARO),
    });
    pagina.drawText("Titos · documento generado automáticamente", {
      x: MARGIN,
      y: MARGIN + 4,
      size: 7.5,
      font: fontRegular,
      color: rgb(...GRIS_CLARO),
    });
    const textoPagina = `Página ${i + 1} de ${paginas.length}`;
    const anchoPagina = fontRegular.widthOfTextAtSize(textoPagina, 7.5);
    pagina.drawText(textoPagina, {
      x: PAGE_WIDTH - MARGIN - anchoPagina,
      y: MARGIN + 4,
      size: 7.5,
      font: fontRegular,
      color: rgb(...GRIS_CLARO),
    });
  });

  return pdf.save();
}

type PedidoItemPDF = {
  nombreProducto: string;
  unidad: string;
  requierePesaje: boolean;
  precioVenta: number;
  cantidadPedida: number;
  cantidadAsignada: number | null;
  cantidadSurtida: number | null;
  pesoSurtidoKg: number | null;
};

type CajaPDF = {
  numero: string;
  cincho1: string;
  cincho2: string;
  categoria: string;
  items: { nombreProducto: string; cantidad: number }[];
};

export async function generarPdfPedido(pedido: {
  folio: string;
  corte: string;
  estado: string;
  sucursalNombre: string;
  repartidorNombre?: string | null;
  items: PedidoItemPDF[];
  cajas: CajaPDF[];
}): Promise<Uint8Array> {
  const total = pedido.items.reduce((s, i) => s + montoLineaPedido(i), 0);

  const filas = pedido.items.map((i) => [
    i.nombreProducto + (i.requierePesaje ? " (pesaje)" : ""),
    `${i.cantidadPedida} ${i.unidad}`,
    i.cantidadAsignada != null ? String(i.cantidadAsignada) : "—",
    i.cantidadSurtida != null ? `${i.cantidadSurtida}${i.pesoSurtidoKg ? ` (${i.pesoSurtidoKg}kg)` : ""}` : "—",
    formatMoney(i.precioVenta),
    formatMoney(montoLineaPedido(i)),
  ]);

  const filasCajas = pedido.cajas.map((c) => [
    `Caja ${c.numero}`,
    c.categoria,
    c.items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", "),
    `${c.cincho1} / ${c.cincho2}`,
  ]);

  return generarTablaPDF({
    titulo: `Pedido ${pedido.folio}`,
    subtitulo: [
      `Sucursal: ${pedido.sucursalNombre}`,
      `Corte: ${pedido.corte}  ·  Estado: ${pedido.estado}`,
      ...(pedido.repartidorNombre ? [`Repartidor: ${pedido.repartidorNombre}`] : []),
    ],
    tabla: {
      columnas: [
        { header: "Producto", width: 175 },
        { header: "Pedido", width: 65 },
        { header: "Nivelado", width: 60 },
        { header: "Surtido", width: 80 },
        { header: "P. venta", width: 65, align: "right" },
        { header: "Subtotal", width: 70, align: "right" },
      ],
      filas,
    },
    totalLabel: "Total:",
    totalValor: formatMoney(total),
    tablaExtra:
      filasCajas.length > 0
        ? {
            titulo: "Cajas selladas",
            columnas: [
              { header: "Caja", width: 60 },
              { header: "Categoría", width: 90 },
              { header: "Contenido", width: 255 },
              { header: "Cinchos", width: 105 },
            ],
            filas: filasCajas,
          }
        : undefined,
  });
}

type OrdenItemPDF = {
  nombreProducto: string;
  cantidadOrdenada: number;
  cantidadRecibida: number | null;
  precioUnitario: number;
};

export async function generarPdfOrdenCompra(orden: {
  folio: string;
  estado: string;
  proveedorNombre: string;
  fecha: string;
  items: OrdenItemPDF[];
}): Promise<Uint8Array> {
  const montoLinea = (i: OrdenItemPDF) => (i.cantidadRecibida ?? i.cantidadOrdenada) * i.precioUnitario;
  const total = orden.items.reduce((s, i) => s + montoLinea(i), 0);

  const filas = orden.items.map((i) => [
    i.nombreProducto,
    String(i.cantidadOrdenada),
    i.cantidadRecibida != null ? String(i.cantidadRecibida) : "—",
    formatMoney(i.precioUnitario),
    formatMoney(montoLinea(i)),
  ]);

  return generarTablaPDF({
    titulo: `Orden de compra ${orden.folio}`,
    subtitulo: [`Proveedor: ${orden.proveedorNombre}`, `Fecha: ${orden.fecha}  ·  Estado: ${orden.estado}`],
    tabla: {
      columnas: [
        { header: "Producto", width: 195 },
        { header: "Ordenado", width: 80 },
        { header: "Recibido", width: 80 },
        { header: "P. unitario", width: 80, align: "right" },
        { header: "Subtotal", width: 80, align: "right" },
      ],
      filas,
    },
    totalLabel: "Total:",
    totalValor: formatMoney(total),
  });
}
