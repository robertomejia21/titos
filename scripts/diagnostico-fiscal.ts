// Cuánto falta para poder timbrar. Solo lee: no escribe nada ni toca el PAC.
//
//   npm run diagnostico:fiscal
//
// Un producto sin IVA o IEPS definido bloquea el timbrado de cualquier factura
// donde aparezca, por diseño: el SAT valida el desglose renglón por renglón y
// un CFDI timbrado con impuestos mal ya no se corrige, se cancela.

import { connectDB } from "../src/lib/db";
import Producto from "../src/models/Producto";
import Factura from "../src/models/Factura";
import { obtenerConfiguracion } from "../src/lib/configuracion";
import { EMISOR_VACIO, emisorCompleto, type EmisorFiscal } from "../src/lib/emisorFiscal";
import mongoose from "mongoose";

function barra(parte: number, total: number, ancho = 28) {
  if (!total) return "";
  const llenos = Math.round((parte / total) * ancho);
  return `${"█".repeat(llenos)}${"░".repeat(ancho - llenos)} ${Math.round((parte / total) * 100)}%`;
}

async function main() {
  await connectDB();

  console.log("\nDiagnóstico para timbrar\n");

  // 1. Datos de la empresa emisora.
  const config = await obtenerConfiguracion();
  const emisor: EmisorFiscal = { ...EMISOR_VACIO, ...(config.emisorFiscal ?? {}) };
  console.log("1. Datos fiscales de la empresa");
  if (emisorCompleto(emisor)) {
    console.log(`  OK    ${emisor.rfc} — ${emisor.razonSocial}`);
    console.log(`        régimen ${emisor.regimenFiscal} · CP ${emisor.codigoPostal}`);
  } else {
    console.log("  FALTA Captúralos en Configuración de matriz > Datos fiscales de la empresa.");
    for (const [campo, valor] of Object.entries(emisor)) {
      if (!valor) console.log(`        sin ${campo}`);
    }
  }

  // 2. Productos activos y su situación fiscal.
  const activos = { activo: true };
  const total = await Producto.countDocuments(activos);
  const sinBloque = await Producto.countDocuments({ ...activos, fiscal: { $exists: false } });
  const ivaPendiente = await Producto.countDocuments({ ...activos, "fiscal.iva": "pendiente" });
  const iepsPendiente = await Producto.countDocuments({ ...activos, "fiscal.iepsTipo": "pendiente" });
  const bloqueados = await Producto.countDocuments({
    ...activos,
    $or: [
      { fiscal: { $exists: false } },
      { "fiscal.iva": "pendiente" },
      { "fiscal.iepsTipo": "pendiente" },
    ],
  });
  const listos = total - bloqueados;

  console.log("\n2. Productos activos");
  console.log(`  ${total} en total`);
  console.log(`  ${listos} listos para timbrar   ${barra(listos, total)}`);
  console.log(`  ${bloqueados} bloquean su factura`);
  if (sinBloque) console.log(`        ${sinBloque} sin datos fiscales capturados`);
  if (ivaPendiente) console.log(`        ${ivaPendiente} con IVA pendiente de confirmar`);
  if (iepsPendiente) console.log(`        ${iepsPendiente} con IEPS pendiente de confirmar`);

  // Sin clave del SAT no se bloquea: el CFDI sale con la genérica 01010101,
  // que es válida, pero conviene saber cuántos van así.
  const sinClave = await Producto.countDocuments({
    ...activos,
    $or: [{ "fiscal.claveProdServ": "" }, { "fiscal.claveProdServ": { $exists: false } }],
  });
  if (sinClave) console.log(`  ${sinClave} saldrían con la clave genérica del SAT (01010101)`);

  // 3. Facturas que esperan timbre.
  const porTimbrar = await Factura.countDocuments({
    estado: "generada",
    "timbrado.estado": { $in: ["no_timbrada", "error"] },
  });
  const timbradas = await Factura.countDocuments({ "timbrado.estado": "timbrada" });
  console.log("\n3. Facturas");
  console.log(`  ${timbradas} timbradas`);
  console.log(`  ${porTimbrar} generadas sin timbrar`);

  // 4. El candado.
  console.log("\n4. Candado de emisión");
  console.log(
    process.env.SW_TIMBRADO_HABILITADO === "1"
      ? "  ABIERTO  SW_TIMBRADO_HABILITADO=1: el sistema puede emitir CFDI reales."
      : "  CERRADO  SW_TIMBRADO_HABILITADO distinto de 1: timbrar() se niega a emitir.",
  );

  console.log("");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
