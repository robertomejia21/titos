import assert from "node:assert/strict";
import { ejecutarEnPuente, estadoPuente, resultadoEnPuente } from "../src/lib/puenteCaja";
import { nuevoNumeroControl } from "../src/lib/banorte";

// Prueba de contrato contra el puente de caja real en modo simulador:
//   cd puente-caja && dotnet run -- --puerto 18093 --config puente-caja.ejemplo.json
//   npx tsx scripts/check-puente-real.ts http://localhost:18093
// Confirma que lo que manda y espera src/lib/puenteCaja.ts es lo que contesta
// el programa en C#. No toca la base de datos ni la terminal.

async function main() {
  const url = process.argv[2] || "http://localhost:18093";
  const estado = await estadoPuente(fetch, url);
  assert.equal(estado.ok, true);
  assert.equal(estado.pinpad, "simulador", "esta prueba solo corre contra el simulador");

  const nc = nuevoNumeroControl();
  const venta = await ejecutarEnPuente({ comando: "VENTA", numeroControl: nc, monto: 12.5 }, fetch, url);
  assert.equal(venta.resultado, "A");
  assert.equal(venta.numeroControl, nc);
  assert.match(venta.ultimos4 ?? "", /^\d{4}$/);
  assert.ok(venta.referencia, "trae referencia");
  assert.equal(venta.simulado, true);
  assert.equal((await resultadoEnPuente(nc, fetch, url))?.referencia, venta.referencia, "el puente guarda la respuesta");

  const verificacion = await ejecutarEnPuente({ comando: "VERIFICACION", numeroControl: nc }, fetch, url);
  assert.equal(verificacion.resultado, "A");

  const cancelacion = await ejecutarEnPuente(
    { comando: "CANCELACION", numeroControl: nuevoNumeroControl(), monto: 12.5, referencia: venta.referencia },
    fetch,
    url
  );
  assert.equal(cancelacion.resultado, "A");

  const sinRespuesta = await ejecutarEnPuente({ comando: "VENTA", numeroControl: nuevoNumeroControl(), monto: 10.66 }, fetch, url);
  assert.equal(sinRespuesta.resultado, "T", ".66 simula falta de respuesta");

  await assert.rejects(ejecutarEnPuente({ comando: "VENTA", numeroControl: "MAL-NUMERO", monto: 1 }, fetch, url), /control|inv/i);
  console.log(`OK: contrato con el puente real (${url}): estado, venta, resultado guardado, verificación, cancelación, T y validación.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
