// Importe con letra para comprobantes: "DOS MIL QUINIENTOS PESOS 00/100 M.N.".
// Es lo que se firma en un retiro de efectivo: escrito así no se le puede
// agregar un cero a mano al número.

const UNIDADES = [
  "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

/** 0 a 999 en palabras. */
function centenas(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let decenas = "";
  if (resto < 30) decenas = UNIDADES[resto];
  else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    decenas = u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d];
  }
  return [CENTENAS[c], decenas].filter(Boolean).join(" ");
}

/**
 * Entero en palabras. "UNO" se apocopa a "UN" delante de MIL/MILLONES y al
 * final ("UN PESO", "VEINTIÚN PESOS"), que es como se escribe en un cheque.
 */
function entero(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocopar(centenas(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocopar(centenas(miles))} MIL`);
  if (resto) partes.push(centenas(resto));
  return partes.join(" ");
}

function apocopar(texto: string) {
  return texto.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
}

export function importeConLetra(monto: number): string {
  const centavosTotales = Math.round(Math.abs(monto) * 100);
  const pesos = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;
  const palabras = apocopar(entero(pesos));
  const termino = /MILLÓN$|MILLONES$/.test(palabras) ? "DE PESOS" : pesos === 1 ? "PESO" : "PESOS";
  return `${palabras} ${termino} ${String(centavos).padStart(2, "0")}/100 M.N.`;
}
