// Valida el armado del CFDI 4.0 sin hablar con el PAC ni con la base de datos.
// Es la red de seguridad del mapper: mientras estas pruebas pasen, lo que se
// mande a timbrar tiene la forma que el SAT espera.
//
//   npm run check:cfdi

import assert from "node:assert/strict";
import { ErrorCfdi, construirCfdi, fechaCfdi, type FacturaLike, type FiscalPorProducto } from "../src/lib/cfdi";
import { emisorCompleto, emisorDesde, type EmisorFiscal } from "../src/lib/emisorFiscal";
import Configuracion from "../src/models/Configuracion";
import type { FiscalProducto } from "../src/lib/fiscalProducto";

const emisor: EmisorFiscal = {
  rfc: "PVA0307221P2",
  razonSocial: "PROVEEDORA VANFER",
  regimenFiscal: "601",
  codigoPostal: "21000",
};

/** Lee una ruta del CFDI armado: at(cfdi, "Conceptos.0.Impuestos"). */
function at(raiz: unknown, ruta: string): unknown {
  return ruta
    .split(".")
    .reduce<unknown>((valor, llave) => (valor as Record<string, unknown> | undefined)?.[llave], raiz);
}

/** Los traslados de esa ruta, ya como lista con sus campos de texto. */
function traslados(raiz: unknown, ruta: string) {
  return (at(raiz, ruta) as Record<string, string>[] | undefined) ?? [];
}

function fiscal(p: Partial<FiscalProducto>): FiscalProducto {
  return {
    iva: "0",
    iepsTipo: "no_aplica",
    iepsValor: 0,
    claveProdServ: "",
    precioImpuestos: "incluidos",
    ...p,
  };
}

function factura(over: Partial<FacturaLike> = {}): FacturaLike {
  return {
    serie: "A",
    folio: "000123",
    ventaFecha: "2026-09-22T18:00:00.000Z",
    conceptos: [
      { productoId: "leche", claveUnidad: "H87", sku: "LEC-1", descripcion: "Leche entera 1L", unidad: "pieza", cantidad: 2, valorUnitario: 25, importe: 50 },
    ],
    total: 50,
    formaPago: "01",
    metodoPago: "PUE",
    receptor: {
      razonSocial: "Cliente de prueba",
      rfc: "XAXX010101000",
      regimenFiscal: "616",
      usoCfdi: "G03",
      codigoPostal: "21000",
    },
    ...over,
  };
}

const pruebas: [string, () => void][] = [];
function prueba(nombre: string, fn: () => void) {
  pruebas.push([nombre, fn]);
}

/** Lanza la construcción esperando ErrorCfdi y devuelve sus problemas. */
function problemasDe(f: FacturaLike, fiscales: FiscalPorProducto, e = emisor) {
  try {
    construirCfdi(f, e, fiscales);
  } catch (error) {
    if (error instanceof ErrorCfdi) return error.problemas;
    throw error;
  }
  throw new Error("Se esperaba ErrorCfdi y el CFDI se armó.");
}

prueba("tasa 0%: traslada en ceros, no se omite", () => {
  const cfdi = construirCfdi(factura(), emisor, new Map([["leche", fiscal({ iva: "0" })]]));
  assert.equal(at(cfdi, "Version"), "4.0");
  assert.equal(at(cfdi, "SubTotal"), "50.00");
  assert.equal(at(cfdi, "Total"), "50.00");
  // Tasa 0 no es lo mismo que exento: el concepto sí traslada, con importe
  // cero, y el comprobante lleva su nodo Impuestos sumando cero.
  assert.equal(at(cfdi, "Impuestos.TotalImpuestosTrasladados"), "0.00");
  assert.equal(at(cfdi, "Conceptos.0.ObjetoImp"), "02");
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.TasaOCuota"), "0.000000");
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.Importe"), "0.00");
});

prueba("16%: desglosa y cuadra con el total", () => {
  const f = factura({
    conceptos: [{ productoId: "jabon", claveUnidad: "H87", descripcion: "Jabón", cantidad: 1, valorUnitario: 100, importe: 100 }],
    total: 116,
  });
  const cfdi = construirCfdi(f, emisor, new Map([["jabon", fiscal({ iva: "16" })]]));
  assert.equal(at(cfdi, "SubTotal"), "100.00");
  assert.equal(at(cfdi, "Total"), "116.00");
  assert.equal(at(cfdi, "Impuestos.TotalImpuestosTrasladados"), "16.00");
  assert.equal(traslados(cfdi, "Impuestos.Traslados").length, 1);
  assert.equal(at(cfdi, "Impuestos.Traslados.0.Impuesto"), "002");
  assert.equal(at(cfdi, "Impuestos.Traslados.0.TasaOCuota"), "0.160000");
});

prueba("exento: el concepto lleva el nodo sin Importe ni TasaOCuota", () => {
  const cfdi = construirCfdi(factura(), emisor, new Map([["leche", fiscal({ iva: "exento" })]]));
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.TipoFactor"), "Exento");
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.Importe"), undefined, "un traslado exento no lleva Importe");
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.TasaOCuota"), undefined, "un traslado exento no lleva TasaOCuota");
  // Si todo es exento no hay nada que trasladar: el comprobante va sin el nodo.
  assert.equal(at(cfdi, "Impuestos"), undefined);
});

prueba("IEPS por porcentaje: el IVA se calcula sobre base más IEPS", () => {
  const f = factura({
    conceptos: [{ productoId: "refresco", claveUnidad: "H87", descripcion: "Refresco", cantidad: 1, valorUnitario: 100, importe: 100 }],
    total: 125.28, // 100 + 8 de IEPS + 17.28 de IVA (16% sobre 108)
  });
  const cfdi = construirCfdi(
    f,
    emisor,
    new Map([["refresco", fiscal({ iva: "16", iepsTipo: "porcentaje", iepsValor: 8 })]]),
  );
  const lista = traslados(cfdi, "Conceptos.0.Impuestos.Traslados");
  const ieps = lista.find((t) => t.Impuesto === "003");
  const iva = lista.find((t) => t.Impuesto === "002");
  assert.equal(ieps?.Importe, "8.00");
  assert.equal(iva?.Base, "108.00", "el IVA se calcula sobre la base más el IEPS");
  assert.equal(iva?.Importe, "17.28");
  assert.equal(at(cfdi, "Impuestos.TotalImpuestosTrasladados"), "25.28");
});

prueba("IEPS por cuota: se multiplica por la cantidad, no por el importe", () => {
  const f = factura({
    conceptos: [{ productoId: "cigarros", claveUnidad: "H87", descripcion: "Cigarros", cantidad: 3, valorUnitario: 50, importe: 150 }],
    total: 180.96, // 150 + 6 de cuota + 16% sobre 156
  });
  const cfdi = construirCfdi(
    f,
    emisor,
    new Map([["cigarros", fiscal({ iva: "16", iepsTipo: "cuota", iepsValor: 2 })]]),
  );
  const ieps = traslados(cfdi, "Conceptos.0.Impuestos.Traslados").find((t) => t.Impuesto === "003");
  assert.equal(ieps?.TipoFactor, "Cuota");
  assert.equal(ieps?.Importe, "6.00", "2 de cuota por 3 piezas");
});

prueba("tasas distintas en el mismo ticket: un renglón de totales por tasa", () => {
  const f = factura({
    conceptos: [
      { productoId: "leche", claveUnidad: "H87", descripcion: "Leche", cantidad: 1, valorUnitario: 25, importe: 25 },
      { productoId: "jabon", claveUnidad: "H87", descripcion: "Jabón", cantidad: 1, valorUnitario: 100, importe: 100 },
    ],
    total: 141, // 25 a tasa 0 + 100 con 16
  });
  const cfdi = construirCfdi(
    f,
    emisor,
    new Map([
      ["leche", fiscal({ iva: "0" })],
      ["jabon", fiscal({ iva: "16" })],
    ]),
  );
  assert.equal(traslados(cfdi, "Impuestos.Traslados").length, 2, "una tasa 0 y una 16 son dos renglones");
  assert.equal(at(cfdi, "Impuestos.TotalImpuestosTrasladados"), "16.00");
});

prueba("clave del SAT del producto gana sobre la genérica", () => {
  const cfdi = construirCfdi(
    factura(),
    emisor,
    new Map([["leche", fiscal({ claveProdServ: "50131600" })]]),
  );
  assert.equal(at(cfdi, "Conceptos.0.ClaveProdServ"), "50131600");
});

prueba("sin clave del producto usa la genérica", () => {
  const cfdi = construirCfdi(factura(), emisor, new Map([["leche", fiscal({})]]));
  assert.equal(at(cfdi, "Conceptos.0.ClaveProdServ"), "01010101");
});

prueba("IVA 8% con la clave genérica: no se timbra", () => {
  const f = factura({ total: 54 });
  const p = problemasDe(f, new Map([["leche", fiscal({ iva: "8" })]]));
  assert.ok(p.some((x) => x.includes("franja fronteriza")), p.join(" "));
});

prueba("IVA 8% con clave del producto: timbra al 8%", () => {
  const f = factura({ total: 54 });
  const cfdi = construirCfdi(f, emisor, new Map([["leche", fiscal({ iva: "8", claveProdServ: "50131700" })]]));
  assert.equal(at(cfdi, "Conceptos.0.ClaveProdServ"), "50131700");
  assert.equal(at(cfdi, "Conceptos.0.Impuestos.Traslados.0.TasaOCuota"), "0.080000");
  assert.equal(at(cfdi, "Total"), "54.00");
});

prueba("producto con IVA pendiente: no se timbra", () => {
  const p = problemasDe(factura(), new Map([["leche", fiscal({ iva: "pendiente" })]]));
  assert.ok(p.some((x) => x.includes("IVA pendiente")), p.join(" "));
});

prueba("producto sin datos fiscales: no se timbra", () => {
  const p = problemasDe(factura(), new Map());
  assert.ok(p.some((x) => x.includes("no tiene datos fiscales")), p.join(" "));
});

prueba("total que no cuadra con los impuestos: no se timbra", () => {
  // La factura dice 50 pero el producto es 16%: 50 + 8 = 58.
  const p = problemasDe(factura(), new Map([["leche", fiscal({ iva: "16" })]]));
  assert.ok(p.some((x) => x.includes("y la factura dice")), p.join(" "));
});

prueba("emisor incompleto: no se timbra", () => {
  const p = problemasDe(factura(), new Map([["leche", fiscal({})]]), {
    rfc: "",
    razonSocial: "",
    regimenFiscal: "",
    codigoPostal: "",
  });
  assert.ok(p.some((x) => x.includes("datos fiscales de la empresa")), p.join(" "));
});

prueba("receptor incompleto: reporta todo junto, no de uno en uno", () => {
  const f = factura({
    receptor: { razonSocial: "", rfc: "", regimenFiscal: "", usoCfdi: "", codigoPostal: "" },
  });
  const p = problemasDe(f, new Map([["leche", fiscal({})]]));
  assert.ok(p.length >= 4, `se esperaban varios problemas juntos, llegaron ${p.length}`);
});

prueba("fecha futura se recorta al momento de emitir", () => {
  const ahora = new Date("2026-09-24T23:26:31Z");
  const futuro = new Date(ahora.getTime() + 86400000);
  assert.equal(fechaCfdi(futuro, "21050", ahora), "2026-09-24T16:26:31");
});

prueba("fecha en hora local del lugar de expedición, no en UTC", () => {
  // El caso real: el servidor en UTC mandaba 23:25 y en Mexicali eran las 16:25.
  const venta = "2026-09-24T23:25:44.000Z";
  const ahora = new Date("2026-09-24T23:26:31Z");
  assert.equal(fechaCfdi(venta, "21050", ahora), "2026-09-24T16:25:44", "Mexicali en horario de verano");
  assert.equal(fechaCfdi(venta, "06600", ahora), "2026-09-24T17:25:44", "Ciudad de México");
  const cfdi = construirCfdi(factura({ ventaFecha: venta }), emisor, new Map([["leche", fiscal({})]]));
  assert.match(String(at(cfdi, "Fecha")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

prueba("venta de hace más de 72 horas se timbra con la hora de emisión", () => {
  const ahora = new Date("2026-09-24T23:26:31Z");
  assert.equal(fechaCfdi("2026-09-20T18:00:00.000Z", "21050", ahora), "2026-09-24T16:26:31");
});

prueba("sello y certificado van vacíos: los pone el PAC", () => {
  const cfdi = construirCfdi(factura(), emisor, new Map([["leche", fiscal({})]]));
  assert.equal(at(cfdi, "Sello"), "");
  assert.equal(at(cfdi, "NoCertificado"), "");
  assert.equal(at(cfdi, "Certificado"), "");
});

prueba("emisor guardado en Mongoose se lee completo", () => {
  // Regresión: `{...config.emisorFiscal}` sobre un documento de Mongoose copia
  // las propiedades internas del subdocumento y deja los campos vacíos, así que
  // el sistema creía que nunca se habían capturado y se negaba a timbrar.
  const config = new Configuracion({
    emisorFiscal: {
      rfc: "PVA0307221P2",
      razonSocial: "PROVEEDORA VANFER",
      regimenFiscal: "601",
      codigoPostal: "21050",
    },
  });
  const leido = emisorDesde(config.emisorFiscal);
  assert.equal(leido.rfc, "PVA0307221P2");
  assert.equal(leido.razonSocial, "PROVEEDORA VANFER");
  assert.equal(leido.regimenFiscal, "601");
  assert.equal(leido.codigoPostal, "21050");
  assert.ok(emisorCompleto(leido), "un emisor capturado debe contar como completo");
  const cfdi = construirCfdi(factura(), leido, new Map([["leche", fiscal({})]]));
  assert.equal(at(cfdi, "Emisor.Rfc"), "PVA0307221P2");
});

prueba("emisor sin capturar sigue contando como incompleto", () => {
  const vacio = emisorDesde(new Configuracion({}).emisorFiscal);
  assert.equal(emisorCompleto(vacio), false);
});

prueba("CP de la sucursal manda sobre el del emisor", () => {
  const cfdi = construirCfdi(factura(), emisor, new Map([["leche", fiscal({})]]), {
    lugarExpedicion: "22000",
  });
  assert.equal(at(cfdi, "LugarExpedicion"), "22000");
});

let fallas = 0;
console.log("\nCFDI 4.0 — armado del comprobante\n");
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
