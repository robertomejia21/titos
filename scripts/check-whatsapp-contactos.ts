// Comprobación de la precedencia de nombres del monitor de WhatsApp: qué se
// enseña cuando el contacto está en la agenda del teléfono, cuando sólo trae
// nombre de perfil, y cuando no hay más que el número.
import { nombreDeContacto } from "@/lib/greenApi";

let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${ok ? "" : `\n      esperado: ${esperado}\n      real:     ${real}`}`);
}

check(
  "la agenda del teléfono manda sobre el nombre de perfil",
  nombreDeContacto("5216641112233", "Rob 🔥", { name: "Rob 🔥", contactName: "Roberto Mejía" }),
  "Roberto Mejía"
);
check(
  "sin nombre en la agenda queda el del perfil",
  nombreDeContacto("5216641112233", "Rob 🔥", { name: "Rob 🔥", contactName: "" }),
  "Rob 🔥"
);
check(
  "contacto que no está en la agenda: el nombre de perfil de Green API",
  nombreDeContacto("5216641112233", "", { name: "Rob 🔥" }),
  "Rob 🔥"
);
check(
  "sin agenda ni perfil se enseña el número",
  nombreDeContacto("5216641112233", "", undefined),
  "5216641112233"
);
check(
  "agenda ilegible (getContacts falló) y sin perfil: el número",
  nombreDeContacto("5216641112233", "", {}),
  "5216641112233"
);

console.log(fallos === 0 ? "\nTodo bien" : `\n${fallos} falla(s)`);
process.exit(fallos === 0 ? 0 : 1);
