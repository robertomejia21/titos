import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

let cachedSecretKey: Uint8Array | null = null;

function getSecretKey() {
  if (cachedSecretKey) return cachedSecretKey;
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("Falta la variable de entorno JWT_SECRET");
  }
  cachedSecretKey = new TextEncoder().encode(JWT_SECRET);
  return cachedSecretKey;
}

export type SessionPayload = {
  userId: string;
  email: string;
  nombre: string;
  role: "matriz" | "sucursal";
  // Rol interno de la sucursal; los tokens viejos no lo traen (se tratan como "admin")
  sucursalRol?: "admin" | "ventas" | null;
  sucursalId: string | null;
  /**
   * Permisos efectivos, resueltos al iniciar sesión. Viajan en el token para
   * que el proxy y el menú puedan decidir sin consultar la base en cada
   * navegación. Los tokens emitidos antes de que existieran los roles no los
   * traen; `permisosDeSesion()` los deduce del rol viejo.
   */
  permisos?: string[];
  perfilDocumentoId?: string;
};

export const SESSION_COOKIE = "titos_session";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
