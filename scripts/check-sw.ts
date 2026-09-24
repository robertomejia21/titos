// Prueba de conexión con el PAC SW sapien. No toca la base de datos ni las
// facturas del sistema: autentica, consulta el saldo y timbra un CFDI de
// juguete contra el ambiente de pruebas.
//
//   npm run check:sw            autentica y consulta saldo
//   npm run check:sw -- --timbrar   además timbra y cancela un CFDI de prueba
//
// El CFDI de prueba usa el RFC público del SAT para demos (EKU9003173C9,
// ESCUELA KEMPER URGATE). Es el que SW trae con CSD cargado en su sandbox, así
// que sirve para verificar el enlace completo antes de tener el CSD del cliente.

import {
  ErrorSw,
  ambienteSw,
  cancelar,
  certificados,
  esProduccion,
  saldo,
  swConfigurado,
  timbrar,
  token,
} from "../src/lib/sw";

const RFC_PRUEBA = "EKU9003173C9";
const timbrado = process.argv.includes("--timbrar");

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

function falla(msg: string, error: unknown): never {
  console.error(`  FALLA  ${msg}`);
  if (error instanceof ErrorSw) {
    console.error(`         ${error.message}`);
    if (error.codigo) console.error(`         código: ${error.codigo}`);
    if (error.detalle) console.error(`         detalle: ${error.detalle}`);
  } else {
    console.error(`         ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
}

/** CFDI 4.0 mínimo, tasa 0% como el abarrote. Sello y certificado los pone SW. */
function cfdiDePrueba() {
  const fecha = new Date();
  fecha.setMinutes(fecha.getMinutes() - 5); // el SAT rechaza fechas futuras
  return {
    Version: "4.0",
    Serie: "PRUEBA",
    Folio: String(Date.now()).slice(-6),
    Fecha: fecha.toISOString().slice(0, 19),
    FormaPago: "01",
    MetodoPago: "PUE",
    Sello: "",
    NoCertificado: "",
    Certificado: "",
    SubTotal: "10.00",
    Descuento: "0.00",
    Moneda: "MXN",
    Total: "10.00",
    TipoDeComprobante: "I",
    Exportacion: "01",
    LugarExpedicion: "45610",
    Emisor: { Rfc: RFC_PRUEBA, Nombre: "ESCUELA KEMPER URGATE", RegimenFiscal: "601" },
    Receptor: {
      Rfc: RFC_PRUEBA,
      Nombre: "ESCUELA KEMPER URGATE",
      DomicilioFiscalReceptor: "45610",
      RegimenFiscalReceptor: "601",
      UsoCFDI: "G03",
    },
    Conceptos: [
      {
        ClaveProdServ: "01010101",
        NoIdentificacion: "PRUEBA",
        Cantidad: "1",
        ClaveUnidad: "H87",
        Unidad: "Pieza",
        Descripcion: "Articulo de prueba de conexion",
        ValorUnitario: "10.00",
        Importe: "10.00",
        Descuento: "0.00",
        ObjetoImp: "02",
        Impuestos: {
          Traslados: [
            { Base: "10.00", Importe: "0.00", Impuesto: "002", TasaOCuota: "0.000000", TipoFactor: "Tasa" },
          ],
        },
      },
    ],
    Impuestos: {
      TotalImpuestosTrasladados: "0.00",
      Traslados: [
        { Base: "10.00", Importe: "0.00", Impuesto: "002", TasaOCuota: "0.000000", TipoFactor: "Tasa" },
      ],
    },
  };
}

async function main() {
  const destino = process.env.SW_URL || "https://services.test.sw.com.mx (default)";
  console.log(`\nSW sapien — prueba de conexión`);
  console.log(`  ambiente: ${esProduccion() ? "PRODUCCIÓN" : "pruebas"}`);
  console.log(`  services: ${destino}`);
  console.log(`  usuario:  ${process.env.SW_USER ? process.env.SW_USER.replace(/(.{3}).*(@.*)/, "$1***$2") : "(sin SW_USER)"}`);
  console.log(`  en uso:   ${ambienteSw()}\n`);

  if (!swConfigurado()) {
    console.error("  FALTA  No hay credenciales. Llena SW_USER y SW_PASSWORD en .env.local");
    console.error("         y corre de nuevo con: npm run check:sw");
    process.exit(1);
  }

  // Timbrar contra producción cuesta dinero y emite un CFDI real ante el SAT.
  // No se hace desde un script de diagnóstico, ni con bandera.
  if (timbrado && esProduccion()) {
    console.error("  ALTO  SW_URL apunta a producción: no se timbra de prueba ahí.");
    console.error("        Cambia SW_URL a https://services.test.sw.com.mx para probar.");
    process.exit(1);
  }

  console.log("1. Autenticación");
  let jwt = "";
  try {
    jwt = await token();
    ok(`token recibido (${jwt.slice(0, 12)}…, ${jwt.length} caracteres)`);
  } catch (error) {
    falla("no se pudo autenticar", error);
  }

  console.log("\n2. Saldo de timbres");
  try {
    const datos = await saldo();
    const timbres = datos?.stampsBalance ?? datos?.saldoTimbres;
    ok(timbres === undefined ? `respuesta: ${JSON.stringify(datos)}` : `timbres disponibles: ${String(timbres)}`);
  } catch (error) {
    // El saldo vive en otro host (api.sw.com.mx) y algunas cuentas de prueba no
    // lo exponen. No es motivo para dar por rota la conexión.
    console.log(`  AVISO  no se pudo leer el saldo: ${error instanceof Error ? error.message : error}`);
    console.log("         (no bloquea el timbrado; revisa SW_API_URL si te interesa el dato)");
  }

  console.log("\n3. Certificados de sello digital (CSD)");
  try {
    const lista = await certificados();
    if (!lista.length) {
      console.log("  FALTA  No hay ningún CSD cargado en la cuenta de SW.");
      console.log("         Sin CSD el PAC no puede sellar: el timbrado falla ahí, no en el código.");
    }
    for (const c of lista) {
      const dias = Math.round((new Date(c.valid_to).getTime() - Date.now()) / 86400000);
      ok(`${c.issuer_rfc} — ${c.issuer_business_name}`);
      console.log(`      tipo ${c.certificate_type} · no. ${c.certificate_number}`);
      console.log(`      ${c.is_active ? "activo" : "INACTIVO"} · vence ${c.valid_to.slice(0, 10)} (${dias} días)`);
      if (dias < 60) console.log("      AVISO  por vencer: renuévalo antes de que tumbe la facturación.");
    }
  } catch (error) {
    console.log(`  AVISO  no se pudo consultar: ${error instanceof Error ? error.message : error}`);
  }

  if (!timbrado) {
    console.log("\nConexión verificada. Para probar un timbrado real de sandbox:");
    console.log("  npm run check:sw -- --timbrar\n");
    return;
  }

  console.log("\n4. Timbrado de prueba");
  let uuid = "";
  try {
    const res = await timbrar(cfdiDePrueba(), { customId: `check-sw-${Date.now()}` });
    uuid = res.uuid;
    ok(`UUID ${res.uuid}`);
    ok(`timbrado ${res.fechaTimbrado}`);
    ok(`XML recibido (${res.cfdi.length} caracteres)`);
  } catch (error) {
    falla("el PAC rechazó el CFDI de prueba", error);
  }

  console.log("\n4. Cancelación de prueba");
  try {
    // Motivo 02: emitido con errores, sin relación. Es el que aplica a algo que
    // nunca debió existir, como este comprobante de juguete.
    const res = await cancelar(RFC_PRUEBA, uuid, "02");
    ok(`cancelado: ${JSON.stringify(res?.acuse ? { acuse: "recibido" } : res)}`);
  } catch (error) {
    // En sandbox la cancelación a veces no está habilitada. El timbrado, que es
    // lo que se estaba probando, ya quedó verificado.
    console.log(`  AVISO  no se pudo cancelar: ${error instanceof Error ? error.message : error}`);
  }

  console.log("\nEnlace con SW verificado de punta a punta.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
