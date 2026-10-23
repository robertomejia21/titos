// Por qué se le regresa mercancía al proveedor al recibir. Vive aparte del
// modelo para que la pantalla de recepción pueda usar las etiquetas sin
// importar mongoose.
export const MOTIVOS_RECHAZO = [
  "quemado_frio",
  "madurez_insuficiente",
  "sobremaduro",
  "tamano_no_deseado",
  "danado",
  "caducidad_proxima",
  "sobreinventario",
  "otro",
] as const;

export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

export const MOTIVO_RECHAZO_LABEL: Record<MotivoRechazo, string> = {
  quemado_frio: "Quemado por frío",
  madurez_insuficiente: "Madurez insuficiente",
  sobremaduro: "Sobremaduro",
  tamano_no_deseado: "Tamaño no deseado",
  danado: "Dañado o golpeado",
  caducidad_proxima: "Caducidad próxima",
  sobreinventario: "Sobreinventario",
  otro: "Otro (ver nota)",
};
