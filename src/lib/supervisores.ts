import UserModel from "@/models/User";
import RolModel from "@/models/Rol";
import { verifyPassword } from "@/lib/auth";

// NIP personal del encargado de turno.
//
// Antes solo existía un NIP de supervisor guardado en la configuración: uno para
// toda la cadena. Servía para exigir autorización, pero no para saber QUIÉN
// autorizó, que es justo lo que se le pregunta a la bitácora cuando un corte no
// cuadra. Ahora cada encargado de turno trae su propio NIP de 6 dígitos y la
// cancelación o el retiro quedan firmados con su nombre.
//
// El NIP de la configuración se conserva como respaldo: las tiendas que todavía
// no reparten NIP personales siguen operando igual.

export const NIP_OPERACION_REGEX = /^\d{6}$/;

export type SupervisorAutorizante = { id: string; nombre: string };

/** Ids de los roles marcados como de supervisor / encargado de turno. */
async function idsRolesSupervisor(): Promise<unknown[]> {
  const roles = await RolModel.find({ esSupervisor: true, activo: true }).select("_id").lean();
  return roles.map((r) => r._id);
}

/**
 * Busca al encargado de turno cuyo NIP coincide. Devuelve null si ninguno.
 *
 * Solo se consideran los encargados de la misma tienda (más los de matriz, que
 * pueden autorizar en cualquiera): el NIP de un encargado de otra sucursal no
 * debe abrir la caja de esta.
 *
 * El hash se compara uno por uno porque bcrypt no permite buscar por valor. Son
 * los encargados activos de UNA tienda, así que la lista es de unos cuantos; el
 * tope evita que una configuración rara convierta esto en un barrido caro.
 */
export async function buscarSupervisorPorNip(
  nip: string,
  sucursalId?: unknown,
  exigirIdentidadUnica = false
): Promise<SupervisorAutorizante | null> {
  if (!NIP_OPERACION_REGEX.test(nip)) return null;

  const rolesSupervisor = await idsRolesSupervisor();
  if (rolesSupervisor.length === 0) return null;

  const candidatos = await UserModel.find({
    activo: true,
    rolId: { $in: rolesSupervisor },
    nipOperacionHash: { $nin: ["", null] },
    ...(sucursalId ? { $or: [{ sucursalId }, { role: "matriz" }] } : {}),
  })
    .select("nombre nipOperacionHash")
    .limit(exigirIdentidadUnica ? 51 : 50)
    .lean();

  if (exigirIdentidadUnica && candidatos.length > 50) return null;
  let encontrado: SupervisorAutorizante | null = null;
  for (const candidato of candidatos) {
    const hash = (candidato as { nipOperacionHash?: string }).nipOperacionHash ?? "";
    if (hash && (await verifyPassword(nip, hash))) {
      if (!exigirIdentidadUnica) return { id: String(candidato._id), nombre: candidato.nombre };
      if (encontrado) return null;
      encontrado = { id: String(candidato._id), nombre: candidato.nombre };
    }
  }

  return encontrado;
}

/** ¿Ya hay al menos un encargado de turno con NIP repartido? */
export async function hayNipsDeSupervisor(sucursalId?: unknown): Promise<boolean> {
  const rolesSupervisor = await idsRolesSupervisor();
  if (rolesSupervisor.length === 0) return false;

  const alguno = await UserModel.exists({
    activo: true,
    rolId: { $in: rolesSupervisor },
    nipOperacionHash: { $nin: ["", null] },
    ...(sucursalId ? { $or: [{ sucursalId }, { role: "matriz" }] } : {}),
  });

  return !!alguno;
}
