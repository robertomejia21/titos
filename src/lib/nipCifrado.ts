import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Copia recuperable de los NIP para poder mandarlos por WhatsApp junto con el
// acceso. El hash (bcrypt) sigue siendo lo que valida; esto solo sirve para
// volver a enviarlo. AES-256-GCM con una llave derivada de JWT_SECRET: si el
// secreto cambia, los NIP ya cifrados dejan de poder leerse y hay que volver a
// asignarlos (descifrarNip devuelve null en lugar de tronar).

function llave() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET");
  return createHash("sha256").update(`nip-cifrado:${secret}`).digest();
}

export function cifrarNip(nip: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([cipher.update(nip, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrarNip(cifrado?: string | null): string | null {
  if (!cifrado) return null;
  try {
    const [iv, tag, datos] = cifrado.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", llave(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
