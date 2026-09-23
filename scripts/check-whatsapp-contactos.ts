// Comprobaciones del listado del monitor de WhatsApp: qué conversaciones
// aparecen (sólo las que tienen mensajes) y con qué nombre se muestran.
import { conversacionesDe, nombreDeContacto, type UltimoMensaje } from "@/lib/greenApi";

let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${ok ? "" : `\n      esperado: ${JSON.stringify(esperado)}\n      real:     ${JSON.stringify(real)}`}`);
}

/* ── Nombres ── */

check(
  "la agenda del teléfono manda sobre el nombre de perfil",
  nombreDeContacto("5216641112233", "Rob", { name: "Rob", contactName: "comprasMT" }),
  "comprasMT"
);
check(
  "sin nombre en la agenda queda el del perfil",
  nombreDeContacto("5216641112233", "Rob", { name: "Rob", contactName: "" }),
  "Rob"
);
check(
  "sin agenda ni perfil se enseña el número",
  nombreDeContacto("5216641112233", "", undefined),
  "5216641112233"
);

/* ── Qué conversaciones aparecen ── */

const AGENDA = [
  { id: "5216641112233@c.us", name: "Rob", contactName: "comprasMT" },
  { id: "5216645554433@c.us", name: "", contactName: "almacen mt" },
  // 482 contactos más del teléfono con los que nunca se ha escrito; este es uno.
  { id: "5216649998877@c.us", name: "Vecino", contactName: "Vecino de la esquina" },
];

const MENSAJES: UltimoMensaje[] = [
  { chatId: "5216641112233@c.us", timestamp: 100, chatName: "Rob" },
  { chatId: "5216641112233@c.us", timestamp: 300, chatName: "Rob" },
  { chatId: "5216645554433@c.us", timestamp: 200, senderName: "Almacén" },
  { chatId: "120363000000000000@g.us", timestamp: 400, chatName: "Grupo de avisos" },
  { chatId: undefined, timestamp: 500 },
];

const lista = conversacionesDe(MENSAJES, AGENDA);

check(
  "sólo aparecen los chats con mensajes, del más reciente al más viejo",
  lista.map((c) => c.nombre),
  ["comprasMT", "almacen mt"]
);
check(
  "un contacto de la agenda sin mensajes no entra al listado",
  lista.some((c) => c.numero === "5216649998877"),
  false
);
check(
  "los grupos y los mensajes sin chatId se descartan",
  lista.length,
  2
);
check(
  "cada renglón se queda con la marca de tiempo del mensaje más nuevo",
  lista.map((c) => c.ultimoMensaje),
  [300, 200]
);
check(
  "sin agenda legible el listado sigue, con el nombre de perfil",
  conversacionesDe(MENSAJES).map((c) => c.nombre),
  ["Rob", "Almacén"]
);

console.log(fallos === 0 ? "\nTodo bien" : `\n${fallos} falla(s)`);
process.exit(fallos === 0 ? 0 : 1);
