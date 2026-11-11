import assert from "node:assert";
import { generarPasswordUsuario } from "../src/lib/auth";

const u = "jperez";
// apellido + "." + DDMM, acentos y espacios fuera, día/mes a 2 dígitos
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: "Pérez", fechaNacimiento: "1990-03-15" }), "Perez.1503");
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: "de la Cruz", fechaNacimiento: "2001-12-05" }), "delaCruz.0512");
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: "Ñañez", fechaNacimiento: "1988-01-09" }), "Nanez.0901");
// Date de entrada (UTC, sin corrimiento de zona)
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: "Lopez", fechaNacimiento: new Date(Date.UTC(1995, 6, 4)) }), "Lopez.0407");
// Sin apellido o sin fecha: usuario + ".Titos"
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: "Pérez", fechaNacimiento: "" }), "jperez.Titos");
assert.strictEqual(generarPasswordUsuario({ usuario: u, apellidoPaterno: null, fechaNacimiento: "1990-03-15" }), "jperez.Titos");
assert.strictEqual(generarPasswordUsuario({ usuario: u }), "jperez.Titos");

console.log("check-password OK");
