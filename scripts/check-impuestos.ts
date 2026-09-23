// Impuestos por renglón de venta. Sin red ni base de datos.
//
//   npm run check:impuestos
//
// Lo que se prueba aquí decide cuánto paga el cliente en la caja, así que cada
// caso trae el número esperado escrito a mano, no calculado con la misma
// fórmula que se está probando.

import assert from "node:assert/strict";
import { impuestosDeLinea, totalesDeVenta } from "../src/lib/impuestosVenta";
import { desglosarFactura, type ItemVentaLike } from "../src/lib/facturas";
import type { FiscalProducto } from "../src/lib/fiscalProducto";

function fiscal(p: Partial<FiscalProducto>): FiscalProducto {
  return {
    iva: "0",
    iepsTipo: "no_aplica",
    iepsValor: 0,
    claveProdServ: "",
    precioImpuestos: "sin_impuestos",
    ...p,
  };
}

const pruebas: [string, () => void][] = [];
function prueba(nombre: string, fn: () => void) {
  pruebas.push([nombre, fn]);
}

prueba("8% encima de 85 cobra 91.80", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "8" }));
  assert.equal(r.base, 85);
  assert.equal(r.iva, 6.8);
  assert.equal(r.total, 91.8);
  assert.equal(r.sinDatos, false);
});

prueba("16% encima de 100 cobra 116", () => {
  const r = impuestosDeLinea(100, 1, fiscal({ iva: "16" }));
  assert.equal(r.iva, 16);
  assert.equal(r.total, 116);
});

prueba("tasa 0 no cambia el cobro", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "0" }));
  assert.equal(r.total, 85);
  assert.equal(r.iva, 0);
  assert.equal(r.sinDatos, false, "tasa 0 es un dato definido, no un faltante");
});

prueba("exento no cambia el cobro", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "exento" }));
  assert.equal(r.total, 85);
  assert.equal(r.impuestos, 0);
  assert.equal(r.sinDatos, false);
});

prueba("IEPS porcentual: el IVA se calcula sobre base más IEPS", () => {
  // 100 + 8 de IEPS = 108; 16% de 108 = 17.28; total 125.28.
  const r = impuestosDeLinea(100, 1, fiscal({ iva: "16", iepsTipo: "porcentaje", iepsValor: 8 }));
  assert.equal(r.ieps, 8);
  assert.equal(r.iva, 17.28);
  assert.equal(r.total, 125.28);
});

prueba("IEPS de cuota: se multiplica por la cantidad", () => {
  // 3 piezas a 50 = 150, cuota 2 por pieza = 6; 16% de 156 = 24.96.
  const r = impuestosDeLinea(150, 3, fiscal({ iva: "16", iepsTipo: "cuota", iepsValor: 2 }));
  assert.equal(r.ieps, 6);
  assert.equal(r.iva, 24.96);
  assert.equal(r.total, 180.96);
});

prueba("precio con impuestos incluidos: el cobro no cambia", () => {
  // 116 con 16% adentro: base 100, IVA 16.
  const r = impuestosDeLinea(116, 1, fiscal({ iva: "16", precioImpuestos: "incluidos" }));
  assert.equal(r.total, 116, "lo cobrado no se mueve cuando el precio ya los trae");
  assert.equal(r.base, 100);
  assert.equal(r.iva, 16);
});

prueba("incluidos con IEPS de cuota: se descuenta antes de despejar", () => {
  // Cobrado 122.80 = base 100 + cuota 6 + 16% de 106 (16.96) = 122.96... se
  // verifica lo esencial: base + impuestos reconstruye exactamente lo cobrado.
  const r = impuestosDeLinea(122.96, 3, fiscal({ iva: "16", iepsTipo: "cuota", iepsValor: 2, precioImpuestos: "incluidos" }));
  assert.equal(r.total, 122.96);
  assert.equal(r.ieps, 6);
  assert.equal(Number((r.base + r.ieps + r.iva).toFixed(2)), 122.96, "debe reconstruir el cobro al centavo");
});

prueba("incluidos: base más impuestos siempre reconstruye el cobro", () => {
  // El centavo del redondeo no puede perderse: si no cuadra, el SAT rechaza.
  for (const importe of [1, 7.77, 33.33, 85, 99.99, 1234.56]) {
    for (const iva of ["8", "16"] as const) {
      const r = impuestosDeLinea(importe, 1, fiscal({ iva, precioImpuestos: "incluidos" }));
      assert.equal(
        Number((r.base + r.ieps + r.iva).toFixed(2)),
        r.total,
        `no cuadró con importe ${importe} e IVA ${iva}`,
      );
    }
  }
});

prueba("IVA pendiente: cobra sin impuesto y lo marca", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "pendiente" }));
  assert.equal(r.total, 85, "la tienda no deja de vender por un dato de catálogo");
  assert.equal(r.sinDatos, true);
});

prueba("IEPS pendiente: cobra sin impuesto y lo marca", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "16", iepsTipo: "pendiente" }));
  assert.equal(r.total, 85);
  assert.equal(r.sinDatos, true);
});

prueba("precioImpuestos pendiente: cobra sin impuesto y lo marca", () => {
  const r = impuestosDeLinea(85, 1, fiscal({ iva: "16", precioImpuestos: "pendiente" }));
  assert.equal(r.total, 85);
  assert.equal(r.sinDatos, true);
});

prueba("producto sin datos fiscales: cobra sin impuesto y lo marca", () => {
  const r = impuestosDeLinea(85, 1, undefined);
  assert.equal(r.total, 85);
  assert.equal(r.sinDatos, true);
});

prueba("totales de una venta mezclada", () => {
  const t = totalesDeVenta([
    { nombre: "Leche", impuestos: impuestosDeLinea(25, 1, fiscal({ iva: "0" })) },
    { nombre: "Jabón", impuestos: impuestosDeLinea(100, 1, fiscal({ iva: "16" })) },
    { nombre: "Sin capturar", impuestos: impuestosDeLinea(10, 1, undefined) },
  ]);
  assert.equal(t.base, 135);
  assert.equal(t.iva, 16);
  assert.equal(t.impuestos, 16);
  assert.equal(t.total, 151);
  assert.deepEqual(t.sinDatosFiscales, ["Sin capturar"], "debe nombrar al producto incompleto");
});

/** Renglón de una venta vieja: sin desglose guardado. */
function itemViejo(over: Partial<ItemVentaLike> = {}): ItemVentaLike {
  return { productoId: "p", sku: "GALA", nombreProducto: "Aderezo", unidad: "pieza", cantidad: 1, precioUnitario: 85, subtotal: 85, ...over };
}

prueba("venta vieja, producto con IVA: separa en vez de sumar", () => {
  // La venta se cobró en 85 y la factura no puede salir por otro importe: el
  // cliente ya pagó. Se separa el impuesto de esos 85.
  const d = desglosarFactura([itemViejo()], 85, 0, new Map([["p", fiscal({ iva: "8", precioImpuestos: "incluidos" })]]));
  assert.equal(d.total, 85, "la factura vale lo que se cobró");
  assert.equal(d.subtotal, 78.7);
  assert.equal(d.iva, 6.3);
});

prueba("venta vieja marcada sin_impuestos: tampoco suma", () => {
  // Cómo esté marcado el producto hoy no cambia lo que se cobró en su momento.
  const d = desglosarFactura([itemViejo()], 85, 0, new Map([["p", fiscal({ iva: "8", precioImpuestos: "sin_impuestos" })]]));
  assert.equal(d.total, 85, "no se le puede facturar al cliente más de lo que pagó");
  assert.equal(d.subtotal, 78.7);
});

prueba("venta vieja sin tasas conocidas: cae a la tasa global", () => {
  const d = desglosarFactura([itemViejo()], 85, 0, new Map());
  assert.equal(d.subtotal, 85);
  assert.equal(d.iva, 0);
  assert.equal(d.total, 85);
});

prueba("venta vieja con producto en pendiente: cae a la tasa global", () => {
  const d = desglosarFactura([itemViejo()], 85, 0, new Map([["p", fiscal({ iva: "pendiente" })]]));
  assert.equal(d.subtotal, 85);
  assert.equal(d.total, 85);
});

prueba("venta nueva: manda el desglose que guardó la caja", () => {
  const linea = impuestosDeLinea(85, 1, fiscal({ iva: "8", precioImpuestos: "incluidos" }));
  const d = desglosarFactura(
    [itemViejo({ base: linea.base, ieps: linea.ieps, iva: linea.iva })],
    85,
    0,
    // Aunque se pasen tasas distintas gana lo guardado: es lo que se cobró.
    new Map([["p", fiscal({ iva: "16", precioImpuestos: "incluidos" })]]),
  );
  assert.equal(d.subtotal, 78.7);
  assert.equal(d.total, 85);
});

let fallas = 0;
console.log("\nImpuestos en el punto de venta\n");
for (const [nombre, fn] of pruebas) {
  try {
    fn();
    console.log(`  OK    ${nombre}`);
  } catch (error) {
    fallas++;
    console.log(`  FALLA ${nombre}`);
    console.log(`        ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${pruebas.length - fallas}/${pruebas.length} pruebas pasaron.\n`);
process.exit(fallas ? 1 : 0);
