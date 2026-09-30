import { sendMessage } from "@/lib/greenApi";
import Configuracion from "@/models/Configuracion";
import RolModel from "@/models/Rol";
import { requiereNipCaja } from "@/lib/nipCaja";
import { permisosDeUsuario } from "@/lib/roles";
import { descifrarNip } from "@/lib/nipCifrado";

const LOGIN_URL = "https://titos.da-vinci.ai/";

export type NipsAcceso = {
  /** NIP personal del gerente de tienda. */
  nipGerente?: string | null;
  /** NIP de matriz para dar de alta supervisores. */
  nipCrearSupervisores?: string | null;
};

/**
 * Qué NIP le corresponden a un usuario y cuáles no se pudieron recuperar.
 *
 * - El gerente de tienda recibe su NIP personal.
 * - Quien puede administrar usuarios (matriz) recibe el NIP para crear
 *   supervisores, que es lo que se le pide al dar de alta a un gerente.
 *
 * Los NIP asignados antes de guardar la copia cifrada no se pueden leer: se
 * devuelven como aviso para que la pantalla diga qué hay que volver a asignar.
 */
export async function nipsParaAcceso(usuario: {
  role?: string | null;
  sucursalRol?: string | null;
  rolId?: unknown;
  permisosIndividuales?: string[] | null;
  nipOperacionHash?: string | null;
  nipOperacionCifrado?: string | null;
}, nipGerentePlano?: string): Promise<NipsAcceso & { avisos: string[] }> {
  const avisos: string[] = [];
  const resultado: NipsAcceso = {};

  const rol = usuario.rolId ? await RolModel.findById(usuario.rolId).select("codigoSistema perfilDocumentoId").lean() : null;
  if (requiereNipCaja(rol)) {
    resultado.nipGerente = nipGerentePlano || descifrarNip(usuario.nipOperacionCifrado);
    if (!resultado.nipGerente && usuario.nipOperacionHash) {
      avisos.push("El NIP de gerente no se incluyó: se asignó antes de poder enviarse. Edita al usuario y asígnale uno nuevo para que le llegue.");
    }
  }

  if (usuario.role === "matriz" && (await permisosDeUsuario(usuario)).includes("usuarios.administrar")) {
    const config = await Configuracion.findOne().select("nipCreacionSupervisorHash nipCreacionSupervisorCifrado").lean<{ nipCreacionSupervisorHash?: string; nipCreacionSupervisorCifrado?: string }>();
    resultado.nipCrearSupervisores = descifrarNip(config?.nipCreacionSupervisorCifrado);
    if (!resultado.nipCrearSupervisores && config?.nipCreacionSupervisorHash) {
      avisos.push("El NIP para crear supervisores no se incluyó: se configuró antes de poder enviarse. Vuelve a guardarlo en Configuración para que le llegue.");
    }
  }

  return { ...resultado, avisos };
}

// Al registrar un usuario con teléfono se le manda, por WhatsApp, primero un
// saludo que abre la conversación con la línea de soporte y luego sus
// credenciales de acceso. Son dos mensajes separados a propósito.
export async function enviarBienvenida(opts: {
  telefono: string;
  nombre: string;
  usuario: string;
  password: string;
} & NipsAcceso) {
  const saludo = await sendMessage(
    opts.telefono,
    `👋 ¡Hola *${opts.nombre}*! Te damos la bienvenida a Titos.\n\n` +
      `Esta es tu línea de soporte: escríbenos por aquí cualquier duda del sistema.`
  );

  const acceso = await sendMessage(
    opts.telefono,
    `🔑 *Tu acceso al sistema*\n\n` +
      `${LOGIN_URL}\n\n` +
      `Usuario: *${opts.usuario}*\n` +
      `Contraseña: *${opts.password}*\n` +
      (opts.nipGerente ? `NIP de gerente: *${opts.nipGerente}*\n` : "") +
      (opts.nipCrearSupervisores ? `NIP para crear supervisores: *${opts.nipCrearSupervisores}*\n` : "") +
      `\nGuárdalos y no los compartas.`
  );

  return [saludo.idMessage, acceso.idMessage];
}
