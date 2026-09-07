// Comprobaciones rápidas de las reglas que se pueden verificar sin base de
// datos: los topes de pagos en dólares y la interpretación del folio que se
// teclea al buscar una venta.
import { motivoRechazoDolares, reglasDolaresDe, topeDolaresEnPesos } from "@/lib/dolares";
import { candidatosFolioVenta } from "@/lib/folios";

let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${ok ? "" : `\n      esperado: ${JSON.stringify(esperado)}\n      real:     ${JSON.stringify(real)}`}`);
}

const sinTopes = reglasDolaresDe({});
check("sin config, se aceptan dólares sin tope", sinTopes, {
  aceptaPagos: true,
  denominacionMaxima: 0,
  porcentajeMaximo: 0,
  montoMaximoUsd: 0,
});
check("sin tope no hay máximo en pesos", topeDolaresEnPesos(sinTopes, 1000), null);
check(
  "sin topes, la venta completa se puede pagar en dólares",
  motivoRechazoDolares({ reglas: sinTopes, total: 1000, montoAplicado: 1000, montoUsd: 60 }),
  null
);

const con40 = reglasDolaresDe({ dolares: { porcentajeMaximo: 40 } });
check("40% de 1000 son 400", topeDolaresEnPesos(con40, 1000), 400);
check(
  "dentro del 40% pasa",
  motivoRechazoDolares({ reglas: con40, total: 1000, montoAplicado: 400, montoUsd: 25 }),
  null
);
check(
  "pasarse del 40% se rechaza",
  motivoRechazoDolares({ reglas: con40, total: 1000, montoAplicado: 400.5, montoUsd: 25 }),
  "Solo se puede pagar hasta el 40% de la venta en dólares (400.00 pesos de 1000.00). " +
    "El resto se cobra en otra forma de pago."
);
check(
  "medio centavo de redondeo no rebota",
  motivoRechazoDolares({ reglas: con40, total: 333.33, montoAplicado: 133.34, montoUsd: 8 }),
  null
);

const con100usd = reglasDolaresDe({ dolares: { montoMaximoUsd: 100 } });
check(
  "100 USD justos pasan",
  motivoRechazoDolares({ reglas: con100usd, total: 5000, montoAplicado: 1700, montoUsd: 100 }),
  null
);
check(
  "101 USD se rechazan",
  motivoRechazoDolares({ reglas: con100usd, total: 5000, montoAplicado: 1717, montoUsd: 101 }),
  "No se reciben más de 100.00 USD en una sola venta."
);

const apagado = reglasDolaresDe({ dolares: { aceptaPagos: false } });
check(
  "con los dólares apagados no se cobra",
  motivoRechazoDolares({ reglas: apagado, total: 100, montoAplicado: 100, montoUsd: 6 }),
  "Por ahora no se están recibiendo pagos en dólares."
);
check(
  "una venta sin dólares nunca se estorba",
  motivoRechazoDolares({ reglas: apagado, total: 100, montoAplicado: 0, montoUsd: 0 }),
  null
);

// Los dos topes se aplican juntos: gana el que se alcance primero.
const ambos = reglasDolaresDe({ dolares: { porcentajeMaximo: 50, montoMaximoUsd: 20 } });
check(
  "el porcentaje pasa pero el monto en USD no",
  motivoRechazoDolares({ reglas: ambos, total: 1000, montoAplicado: 500, montoUsd: 30 }),
  "No se reciben más de 20.00 USD en una sola venta."
);


// --- Folios de venta tecleados al buscar en devoluciones -------------------

check("el numero pelon encuentra la venta", candidatosFolioVenta("123").includes("VTA-000123"), true);
check("el numero pelon tambien prueba notas de venta", candidatosFolioVenta("123").includes("V2-000123"), true);
check("el folio completo se respeta", candidatosFolioVenta("VTA-000123")[0], "VTA-000123");
check("minusculas y sin guion tambien", candidatosFolioVenta("vta123")[0], "VTA-000123");
check("con ceros a la izquierda da lo mismo", candidatosFolioVenta("000123")[0], "VTA-000123");
check("vacio no genera candidatos", candidatosFolioVenta("  "), []);
check("un folio local se busca tal cual", candidatosFolioVenta("VTA-LOCAL-ABC123"), ["VTA-LOCAL-ABC123"]);
// El 123 no debe traer el 1234: por eso se buscan folios exactos, no "contiene".
check("el 123 no genera el folio del 1234", candidatosFolioVenta("123").includes("VTA-001234"), false);

console.log(fallos === 0 ? "\nTodo bien." : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
