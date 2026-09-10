import { createHmac } from "node:crypto";
import UserModel from "@/models/User";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { NIP_OPERACION_REGEX } from "@/lib/supervisores";

export class NipPersonalError extends Error {}

export async function prepararNipPersonal(nip: string, usuarioId?: string) {
  if (!NIP_OPERACION_REGEX.test(nip)) {
    throw new NipPersonalError("El NIP personal debe tener 6 dígitos");
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET");
  const huella = createHmac("sha256", secret).update(`nip-personal:${nip}`).digest("hex");

  // El índice evita que dos altas simultáneas asignen el mismo NIP. Los NIP
  // anteriores solo tienen bcrypt y también se comparan antes de guardarlo.
  await UserModel.collection.createIndex(
    { nipOperacionHuella: 1 },
    { unique: true, partialFilterExpression: { nipOperacionHuella: { $type: "string" } } }
  );
  const candidatos = UserModel.find({
    ...(usuarioId ? { _id: { $ne: usuarioId } } : {}),
    nipOperacionHash: { $exists: true, $ne: "" },
  }).select("nipOperacionHash").lean().cursor();
  for await (const candidato of candidatos) {
    if (await verifyPassword(nip, candidato.nipOperacionHash)) {
      await candidatos.close();
      throw new NipPersonalError("Ese NIP ya está asignado a otra persona. Elige uno diferente");
    }
  }
  return { nipOperacionHash: await hashPassword(nip), nipOperacionHuella: huella };
}

export function esNipDuplicado(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === 11000
    && "keyPattern" in error && !!error.keyPattern
    && typeof error.keyPattern === "object" && "nipOperacionHuella" in error.keyPattern;
}
