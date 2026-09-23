// Búsqueda de productos en la caja. Sin red ni base de datos.
//
//   npm run check:buscar
//
// El caso que más importa es el primero: por esta casilla entra el escáner, y
// un SKU exacto nunca puede perder contra el nombre de otro producto.

import assert from "node:assert/strict";
import { buscarProducto } from "../src/lib/buscarProducto";

const catalogo = [
  { _id: "1", sku: "7501055310838", nombre: "Coca Cola 600ml", alias: ["refresco coca"] },
  { _id: "2", sku: "LECHE-1", nombre: "Leche entera 1L", alias: [] },
  { _id: "3", sku: "LECHE-2", nombre: "Leche deslactosada 1L", alias: ["light"] },
  { _id: "4", sku: "PAN-1", nombre: "Pan blanco grande", alias: [] },
  { _id: "5", sku: "COCA", nombre: "Galleta sabor coca", alias: [] },
  { _id: "6", sku: "JAB-1", nombre: "Jabón Zote rosa", alias: [] },
];

const pruebas: [string, () => void][] = [];
function prueba(nombre: string, fn: () => void) {
  pruebas.push([nombre, fn]);
}

prueba("SKU exacto gana siempre, aunque el texto aparezca en otro nombre", () => {
  // "COCA" es el SKU de la galleta y también está en el nombre del refresco.
  const r = buscarProducto(catalogo, "COCA");
  assert.equal(r.exacto?._id, "5", "un escaneo no puede terminar cobrando otra cosa");
  assert.deepEqual(r.coincidencias, []);
});

prueba("código de barras largo entra directo", () => {
  const r = buscarProducto(catalogo, "7501055310838");
  assert.equal(r.exacto?._id, "1");
});

prueba("SKU sin importar mayúsculas ni espacios", () => {
  assert.equal(buscarProducto(catalogo, "  leche-1  ").exacto?._id, "2");
});

prueba("alias exacto también entra directo", () => {
  assert.equal(buscarProducto(catalogo, "light").exacto?._id, "3");
});

prueba("nombre con una sola coincidencia se agrega sin preguntar", () => {
  const r = buscarProducto(catalogo, "zote");
  assert.equal(r.exacto?._id, "6");
  assert.deepEqual(r.coincidencias, []);
});

prueba("nombre ambiguo NO adivina: devuelve las candidatas", () => {
  const r = buscarProducto(catalogo, "leche");
  assert.equal(r.exacto, null, "con dos leches no se puede elegir por el cajero");
  assert.deepEqual(r.coincidencias.map((p) => p._id).sort(), ["2", "3"]);
});

prueba("acentos no estorban", () => {
  assert.equal(buscarProducto(catalogo, "jabon").exacto?._id, "6");
  assert.equal(buscarProducto(catalogo, "JABÓN zote").exacto?._id, "6");
});

prueba("varias palabras en cualquier orden", () => {
  assert.equal(buscarProducto(catalogo, "entera leche").exacto?._id, "2");
  assert.equal(buscarProducto(catalogo, "blanco pan").exacto?._id, "4");
});

prueba("lo que empieza con lo tecleado va primero", () => {
  const r = buscarProducto(catalogo, "coca cola");
  // "Coca Cola 600ml" empieza con la consulta; la galleta solo la contiene.
  assert.equal(r.exacto?._id, "1");
});

prueba("sin coincidencias devuelve vacío, no la primera del catálogo", () => {
  const r = buscarProducto(catalogo, "tornillo");
  assert.equal(r.exacto, null);
  assert.deepEqual(r.coincidencias, []);
});

prueba("consulta vacía no devuelve nada", () => {
  const r = buscarProducto(catalogo, "   ");
  assert.equal(r.exacto, null);
  assert.deepEqual(r.coincidencias, []);
});

prueba("la lista de candidatas se recorta", () => {
  const muchos = Array.from({ length: 30 }, (_, i) => ({
    _id: String(i), sku: `AGUA-${i}`, nombre: `Agua marca ${i}`, alias: [],
  }));
  assert.equal(buscarProducto(muchos, "agua", 8).coincidencias.length, 8);
});

let fallas = 0;
console.log("\nBúsqueda de productos en la caja\n");
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
