// Se leen en cada llamada, no al cargar el módulo: si el bundle se evalúa en
// build (sin variables de entorno) los valores quedarían vacíos para siempre.
let INSTANCE_ID = "";
let API_TOKEN = "";

function requireEnv() {
  INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID ?? "";
  API_TOKEN = process.env.GREEN_API_TOKEN ?? "";
  if (!INSTANCE_ID || !API_TOKEN) {
    throw new Error("Green API no está configurada (faltan GREEN_API_INSTANCE_ID o GREEN_API_TOKEN)");
  }
}

/** Diagnóstico sin secretos: qué ve el servidor desplegado. */
export function greenApiDiag() {
  const id = process.env.GREEN_API_INSTANCE_ID ?? "";
  return {
    hasInstance: !!id,
    hasToken: !!process.env.GREEN_API_TOKEN,
    host: process.env.GREEN_API_HOST?.replace(/\/$/, "") ?? `https://${id.slice(0, 4)}.api.green-api.com`,
  };
}

function baseUrl() {
  const override = process.env.GREEN_API_HOST;
  if (override) {
    return override.replace(/\/$/, "");
  }
  return `https://${INSTANCE_ID.slice(0, 4)}.api.green-api.com`;
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
  if (data.type === "alreadyLogged") return { qr: null };
  if (data.type !== "qrCode") {
    throw new Error(data.message || "Green API no devolvió un código QR");
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
  const url = `${baseUrl()}/waInstance${INSTANCE_ID}/sendFileByUpload/${API_TOKEN}`;
  const boundary = "----GreenApiBoundary" + Date.now();
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="chatId"\r\n\r\n${chatId(phone)}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileBase64}`,
    `--${boundary}--`,
  ].join("\r\n");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
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
