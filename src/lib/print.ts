import { formatFechaLarga, formatHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";

// Abre una ventana nueva con contenido HTML listo para imprimir y dispara el
// diálogo de impresión del navegador. Se usa para pedidos y órdenes de
// compra, generando el HTML a partir de los datos que ya están cargados en
// pantalla (no requiere otra llamada al servidor).
//
// `zona` es la zona horaria de la sucursal (useZonaHoraria()); sin ella el sello
// de generación saldría con la hora del sistema operativo de la PC.
export function imprimirHTML(titulo: string, contenidoHTML: string, zona: string = ZONA_HORARIA_DEFAULT) {
  const ventana = window.open("", "_blank", "width=850,height=900");
  if (!ventana) return;

  const ahora = new Date();
  const fecha = formatFechaLarga(ahora, zona);
  const hora = formatHora(ahora, zona);

  ventana.document.write(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>${titulo}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #262626; margin: 0; }
          .encabezado {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #0f4a20;
            color: #fff;
            padding: 16px 24px;
          }
          .encabezado .marca { display: flex; align-items: center; gap: 12px; }
          .encabezado img { height: 38px; display: block; }
          .encabezado .marca-texto { line-height: 1.3; }
          .encabezado .marca-texto strong { display: block; font-size: 14px; }
          .encabezado .marca-texto span { font-size: 10px; color: #cfe8d3; }
          .encabezado .generado { font-size: 11px; color: #cfe8d3; text-align: right; line-height: 1.4; }
          .contenido { padding: 24px; }
          h1 { font-size: 19px; margin: 0 0 4px; color: #0f4a20; }
          .subtitulo { color: #666; font-size: 13px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
          th, td { text-align: left; padding: 8px; }
          thead tr { background: #e3f3e6; }
          th { color: #0f4a20; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.02em; }
          tbody tr { border-bottom: 1px solid #eee; }
          tbody tr:nth-child(even) { background: #fafafa; }
          tfoot td { border-top: 2px solid #0f4a20; border-bottom: none; font-weight: 700; padding-top: 12px; color: #0f4a20; }
          .meta { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
          .pie {
            margin-top: 32px;
            padding-top: 10px;
            border-top: 1px solid #ddd;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #999;
          }
          @media print {
            .encabezado, thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="encabezado">
          <div class="marca">
            <img src="/media/logo.png" alt="Mercados Titos" />
            <div class="marca-texto">
              <strong>Mercados Titos</strong>
              <span>Sistema de abasto</span>
            </div>
          </div>
          <div class="generado">Generado el ${fecha}<br />${hora}</div>
        </div>
        <div class="contenido">
          ${contenidoHTML}
          <div class="pie">
            <span>Titos · documento generado automáticamente</span>
            <span>${fecha} · ${hora}</span>
          </div>
        </div>
      </body>
    </html>
  `);

  ventana.document.close();
  ventana.focus();
  ventana.print();
}

/** Escapa texto que viene de la base (nombres de producto, cajero, sucursal). */
export function escaparHTML(texto: string) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Reserva la ventana durante el clic: después de esperar al servidor el navegador puede bloquearla. */
export function abrirVentanaTicket(): Window | null {
  try {
    const ventana = window.open("", "_blank", "width=380,height=700");
    if (ventana) {
      ventana.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Preparando ticket</title></head><body><p>Esperando confirmación de la venta…</p></body></html>');
      ventana.document.close();
    }
    return ventana;
  } catch { return null; }
}

export function cerrarVentanaTicket(ventana: Window | null) {
  try { if (ventana && !ventana.closed) ventana.close(); } catch { /* La ventana puede haberse cerrado desde el navegador. */ }
}

/**
 * Imprime un ticket en rollo de 80 mm (la impresora térmica del mostrador).
 *
 * A diferencia de `imprimirHTML`, que arma un documento tamaño carta con el
 * encabezado verde de la marca, aquí todo va a una sola columna angosta, en
 * monoespaciada y sin fondos de color: la térmica no imprime color y cualquier
 * margen de más recorta el renglón.
 */
export function imprimirTicket(titulo: string, contenidoHTML: string, ventanaPreparada?: Window | null): boolean {
  const ventana = ventanaPreparada === undefined ? abrirVentanaTicket() : ventanaPreparada;
  if (!ventana || ventana.closed) return false;
  try {
  ventana.document.open();

  ventana.document.write(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>${escaparHTML(titulo)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          /*
            Courier New a 11 px reventaba los dígitos en la térmica: el 5 y el 6
            se imprimían con el trazo tan delgado que el cabezal se saltaba
            puntos y quedaban como 3 y 8. Se cambió a Consolas/DejaVu Sans Mono
            (numerales de trazo grueso y con el 6 cerrado), se subió el cuerpo y
            se puso todo el documento en seminegrita: en papel térmico un poco
            de peso de más se lee, uno de menos se pierde.
          */
          body {
            width: 80mm;
            margin: 0;
            padding: 4mm 3mm;
            font-family: Consolas, "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace;
            font-size: 13px;
            font-weight: 600;
            line-height: 1.4;
            letter-spacing: 0.01em;
            color: #000;
            background: #fff;
            /* Los números se alinean en columna y no bailan de renglón a renglón. */
            font-variant-numeric: tabular-nums lining-nums;
            -webkit-font-smoothing: none;
            text-rendering: geometricPrecision;
          }
          .centro { text-align: center; }
          .titulo { font-size: 17px; font-weight: 800; letter-spacing: 0.04em; }
          .sucursal { font-size: 14px; font-weight: 700; }
          .sep { border-top: 1px dashed #000; margin: 5px 0; }
          .fila { display: flex; justify-content: space-between; gap: 6px; }
          /* Los importes nunca se parten de renglón ni se aprietan. */
          .fila span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
          .concepto { flex: 1; word-break: break-word; }
          .fuerte { font-weight: 800; font-size: 15px; }
          /* Lo "tenue" baja de tamaño, nunca de peso: adelgazarlo es justo lo
             que hacía ilegibles los dígitos. */
          .tenue { font-size: 11.5px; font-weight: 600; }
          .pie { margin-top: 8px; font-size: 11.5px; }
          .copia {
            margin: 2px 0 6px;
            text-align: center;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.08em;
          }
          .firma { margin-top: 14px; }
          .firma .linea { border-top: 1px solid #000; margin-bottom: 3px; }
          /* Cada copia arranca en su propio corte de papel. */
          .corte { page-break-after: always; break-after: page; }
          .corte:last-child { page-break-after: auto; break-after: auto; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>${contenidoHTML}</body>
    </html>
  `);

  ventana.document.close();
  ventana.focus();
  ventana.print();
  return true;
  } catch {
    cerrarVentanaTicket(ventana);
    return false;
  }
}
