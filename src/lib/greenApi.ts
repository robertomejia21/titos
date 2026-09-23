// Se leen en cada llamada, no al cargar el módulo: si el bundle se evalúa en
// build (sin variables de entorno) los valores quedarían vacíos para siempre.
let INSTANCE_ID = "";
let API_TOKEN = "";

function requireEnv() {
  // .trim(): pegar el token en el panel de Vercel suele arrastrar un salto de
  // línea, y Green API responde 401 sin que se note de dónde viene.
  INSTANCE_ID = (process.env.GREEN_API_INSTANCE_ID ?? "").trim();
  API_TOKEN = (process.env.GREEN_API_TOKEN ?? "").trim();
  if (!INSTANCE_ID || !API_TOKEN) {
    throw new Error("Green API no está configurada (faltan GREEN_API_INSTANCE_ID o GREEN_API_TOKEN)");
  }
}

/**
 * Diagnóstico sin secretos: qué ve el servidor desplegado. Del token sólo se
 * publican largo y últimos 4 (como los de una tarjeta), que es lo justo para
 * comparar si el valor de Vercel es el mismo que el de local sin exponerlo.
 */
export function greenApiDiag() {
  const id = process.env.GREEN_API_INSTANCE_ID ?? "";
  const raw = process.env.GREEN_API_TOKEN ?? "";
  return {
    instancia: id || "FALTA",
    host: process.env.GREEN_API_HOST?.replace(/\/$/, "") ?? `https://${id.slice(0, 4)}.api.green-api.com`,
    tokenLargo: raw.length,
    tokenFin: raw.slice(-4) || "—",
    // Un espacio o salto de línea pegado al valor en Vercel da 401 sin que se vea.
    tokenConEspacios: raw !== raw.trim(),
  };
}

function baseUrl() {
  const override = process.env.GREEN_API_HOST?.trim();
  if (override) {
    return override.replace(/\/$/, "");
  }
  return `https://${INSTANCE_ID.slice(0, 4)}.api.green-api.com`;
}

// sendFileByUpload es el único endpoint que va al host de medios; el resto usa
// el de API. Si no se configura, se deriva cambiando "api" por "media".
function mediaUrl() {
  const override = process.env.GREEN_API_MEDIA_HOST;
  if (override) return override.replace(/\/$/, "");
  const api = baseUrl();
  return api.includes(".api.") ? api.replace(".api.", ".media.") : api.replace("//api.", "//media.");
}

function chatId(phone: string) {
  return `${phone.replace(/\D/g, "")}@c.us`;
}

export async function sendMessage(phone: string, message: string) {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatId(phone), message }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ idMessage: string }>;
}

export type UltimoMensaje = {
  chatId?: string;
  timestamp?: number;
  senderName?: string;
  chatName?: string;
};

// Los mensajes que entraron y salieron por esta instancia: la única fuente que
// prueba que hubo conversación. No se usa getChats porque WhatsApp sincroniza
// ahí la agenda del teléfono y devuelve contactos con los que nunca se escribió.
export async function getLastMessages(minutes = 44640 /* ~31 días */) {
  requireEnv();
  const inc = `${baseUrl()}/waInstance${INSTANCE_ID}/lastIncomingMessages/${API_TOKEN}?minutes=${minutes}`;
  const out = `${baseUrl()}/waInstance${INSTANCE_ID}/lastOutgoingMessages/${API_TOKEN}?minutes=${minutes}`;
  const traer = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
    }
    return (await res.json().catch(() => [])) as UltimoMensaje[];
  };
  // Si sólo falla una de las dos, la lista sigue con la otra; si fallan ambas se
  // propaga el error, porque "sin conversaciones" y "la API no responde" no
  // pueden verse igual en pantalla.
  const [entrantes, salientes] = await Promise.allSettled([traer(inc), traer(out)]);
  if (entrantes.status === "rejected" && salientes.status === "rejected") throw entrantes.reason;
  return [
    ...(entrantes.status === "fulfilled" ? entrantes.value : []),
    ...(salientes.status === "fulfilled" ? salientes.value : []),
  ];
}

// La agenda del teléfono vinculado: `contactName` es el nombre como está
// guardado ahí, `name` el del perfil de WhatsApp. El monitor prefiere el
// primero para que la lista se lea igual que en el teléfono.
export async function getContacts() {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/getContacts/${API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<
    { id: string; name?: string; contactName?: string; type?: string }[]
  >;
}

// Precedencia de nombres tal como la resuelve el teléfono: manda la agenda,
// luego el nombre que la persona trae en su perfil, y al final el número pelón.
export function nombreDeContacto(
  numero: string,
  nombrePerfil: string,
  agenda?: { name?: string; contactName?: string }
) {
  return agenda?.contactName || nombrePerfil || agenda?.name || numero;
}

export type Conversacion = {
  chatId: string;
  numero: string;
  nombre: string;
  nombrePerfil: string;
  ultimoMensaje: number;
};

/**
 * Arma el listado del monitor: un renglón por chat con mensajes reales, del más
 * reciente al más viejo. La agenda entra sólo para ponerle nombre a esos chats,
 * nunca para agregar renglones: un contacto guardado en el teléfono con el que
 * no se ha conversado no es una conversación y no aparece.
 */
export function conversacionesDe(
  mensajes: UltimoMensaje[],
  agenda: { id: string; name?: string; contactName?: string }[] = []
): Conversacion[] {
  const porId = new Map(agenda.map((c) => [c.id, c]));
  const porChat = new Map<string, Conversacion>();

  for (const m of mensajes) {
    // Sólo chats de persona: los grupos (@g.us) y las difusiones no son
    // conversaciones que el monitor deba contestar.
    if (!m.chatId?.endsWith("@c.us")) continue;
    const ts = m.timestamp ?? 0;
    const previo = porChat.get(m.chatId);
    if (previo && previo.ultimoMensaje >= ts) continue;

    const numero = m.chatId.replace("@c.us", "");
    const enAgenda = porId.get(m.chatId);
    const nombrePerfil = m.chatName || m.senderName || enAgenda?.name || "";
    porChat.set(m.chatId, {
      chatId: m.chatId,
      numero,
      nombrePerfil,
      nombre: nombreDeContacto(numero, nombrePerfil, enAgenda),
      ultimoMensaje: ts,
    });
  }

  return [...porChat.values()].sort((a, b) => b.ultimoMensaje - a.ultimoMensaje);
}

// `urlAvatar` viene vacío cuando el contacto no tiene foto o la tiene
// restringida por privacidad; quien llama decide el respaldo.
export async function getAvatar(chatIdStr: string) {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/getAvatar/${API_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatIdStr }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ urlAvatar?: string; available?: boolean }>;
}

export async function getChatHistory(chatIdStr: string, count = 100) {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/getChatHistory/${API_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatIdStr, count }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<
    {
      idMessage: string;
      timestamp: number;
      typeMessage: string;
      chatId: string;
      textMessage?: string;
      extendedTextMessage?: { text: string };
      senderName?: string;
      type: "incoming" | "outgoing";
    }[]
  >;
}

export async function getStateInstance() {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/getStateInstance/${API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ stateInstance: string }>;
}

// Green API devuelve el QR como base64 pelón (sin el prefijo "data:"), y usa
// el campo `type` para avisar que ya está vinculada o que hubo un error.
export async function getQR(): Promise<{ qr: string | null }> {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/qr/${API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  // "timeout" es normal mientras se genera el código: el modal reintenta solo.
  if (data.type === "alreadyLogged" || data.type === "timeout") return { qr: null };
  if (data.type !== "qrCode") {
    throw new Error(data.message || `Green API devolvió "${data.type}" en vez de un código QR`);
  }
  return { qr: `data:image/png;base64,${data.message}` };
}

export async function logout() {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/logout/${API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export async function sendFileByUrl(phone: string, urlFile: string, fileName: string, caption: string) {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/sendFileByUrl/${API_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: chatId(phone), urlFile, fileName, caption }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ idMessage: string }>;
}

export async function sendFileByUpload(phone: string, fileBase64: string, fileName: string, caption: string) {
  requireEnv();
  const url = `${mediaUrl()}/waInstance${INSTANCE_ID}/sendFileByUpload/${API_TOKEN}`;
  // FormData pone el boundary y manda el PDF como binario: armarlo a mano y
  // mandarlo en base64 llegaba corrupto.
  const form = new FormData();
  form.append("chatId", chatId(phone));
  form.append("fileName", fileName);
  form.append("caption", caption);
  form.append(
    "file",
    new Blob([new Uint8Array(Buffer.from(fileBase64, "base64"))], { type: "application/pdf" }),
    fileName
  );
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ idMessage: string }>;
}

export async function sendButtonsMessage(
  phone: string,
  body: string,
  buttons: { buttonId: string; buttonText: string }[],
  footer?: string
) {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/sendInteractiveButtonsReply/${API_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: chatId(phone),
      body,
      buttons: buttons.slice(0, 3),
      ...(footer ? { footer } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ idMessage: string }>;
}
