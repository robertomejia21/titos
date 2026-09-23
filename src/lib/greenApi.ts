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

export async function getChats() {
  requireEnv();
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/getChats/${API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Green API respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<
    { id: string; name: string; lastMessageTimestamp: number }[]
  >;
}

// Green API restringe getChats en instancias ya autorizadas (responde 401), así
// que el listado de conversaciones se arma con los últimos mensajes entrantes y
// salientes, que sí están disponibles.
export async function getLastMessages(minutes = 44640 /* ~31 días */) {
  requireEnv();
  const inc = `${baseUrl()}/waInstance${INSTANCE_ID}/lastIncomingMessages/${API_TOKEN}?minutes=${minutes}`;
  const out = `${baseUrl()}/waInstance${INSTANCE_ID}/lastOutgoingMessages/${API_TOKEN}?minutes=${minutes}`;
  type UltimoMensaje = { chatId?: string; timestamp?: number; senderName?: string; chatName?: string };
  const traer = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) return [] as UltimoMensaje[];
    return (await res.json().catch(() => [])) as UltimoMensaje[];
  };
  const [entrantes, salientes] = await Promise.all([traer(inc), traer(out)]);
  return [...entrantes, ...salientes];
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
