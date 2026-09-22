import { sendMessage } from "@/lib/greenApi";

const LOGIN_URL = "https://titos.da-vinci.ai/";

// Al registrar un usuario con teléfono se le manda, por WhatsApp, primero un
// saludo que abre la conversación con la línea de soporte y luego sus
// credenciales de acceso. Son dos mensajes separados a propósito.
export async function enviarBienvenida(opts: {
  telefono: string;
  nombre: string;
  usuario: string;
  password: string;
}) {
  await sendMessage(
    opts.telefono,
    `👋 ¡Hola *${opts.nombre}*! Te damos la bienvenida a Titos.\n\n` +
      `Esta es tu línea de soporte: escríbenos por aquí cualquier duda del sistema.`
  );

  await sendMessage(
    opts.telefono,
    `🔑 *Tu acceso al sistema*\n\n` +
      `${LOGIN_URL}\n\n` +
      `Usuario: *${opts.usuario}*\n` +
      `Contraseña: *${opts.password}*\n\n` +
      `Guárdalos y no los compartas.`
  );
}
