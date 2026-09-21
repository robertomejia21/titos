// Normaliza números de WhatsApp de México al formato que WhatsApp espera
// desde 2021 (52 + 10 dígitos, SIN el "1" que antes se insertaba después
// del 52 y que hoy hace que el mensaje se enrute a un JID inexistente:
// Evolution API responde "enviado" pero nunca llega al teléfono real).
// Cubre los formatos con los que alguien pudo haber capturado el número,
// incluyendo el prefijo "521" viejo ya guardado en la base de datos.
export function normalizarWhatsAppMX(numero: string): string {
  const digitos = numero.replace(/\D/g, "");

  // Sólo el número local a 10 dígitos (lo más común aquí).
  if (digitos.length === 10) {
    return `52${digitos}`;
  }

  // "1" + 10 dígitos, sin código de país.
  if (digitos.length === 11 && digitos.startsWith("1")) {
    return `52${digitos.slice(1)}`;
  }

  // Ya viene como 52 + 10 dígitos (formato correcto actual).
  if (digitos.length === 12 && digitos.startsWith("52")) {
    return digitos;
  }

  // Formato viejo 52 + 1 + 10 dígitos (antes de que WhatsApp quitara el "1"
  // para México): se le quita el "1" para obtener el JID correcto.
  if (digitos.length === 13 && digitos.startsWith("521")) {
    return `52${digitos.slice(3)}`;
  }

  // Ya viene completo o es de otro país: se deja tal cual.
  return digitos;
}

export function normalizarWhatsAppUS(numero: string): string {
  const digitos = numero.replace(/\D/g, "");

  // 10 dígitos locales.
  if (digitos.length === 10) return `1${digitos}`;

  // Ya con código de país.
  if (digitos.length === 11 && digitos.startsWith("1")) return digitos;

  return digitos;
}

export function normalizarWhatsApp(numero: string, codigoArea: "+52" | "+1"): string {
  return codigoArea === "+1" ? normalizarWhatsAppUS(numero) : normalizarWhatsAppMX(numero);
}

export function validarTelefono(numero: string, codigoArea: "+52" | "+1"): boolean {
  const digitos = numero.replace(/\D/g, "");
  if (codigoArea === "+52") {
    return digitos.length >= 10 && digitos.length <= 13;
  }
  return digitos.length >= 10 && digitos.length <= 11;
}
