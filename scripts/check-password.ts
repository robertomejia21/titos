import assert from "node:assert";
import { generarPasswordUsuario } from "../src/lib/auth";

// apellido + "." + DDMM, acentos y espacios fuera, día/mes a 2 dígitos
assert.strictEqual(generarPasswordUsuario("Pérez", "1990-03-15"), "Perez.1503");
assert.strictEqual(generarPasswordUsuario("de la Cruz", "2001-12-05"), "delaCruz.0512");
assert.strictEqual(generarPasswordUsuario("Ñañez", "1988-01-09"), "Nanez.0901");
// Date de entrada (UTC, sin corrimiento de zona)
assert.strictEqual(generarPasswordUsuario("Lopez", new Date(Date.UTC(1995, 6, 4))), "Lopez.0407");

console.log("check-password OK");
