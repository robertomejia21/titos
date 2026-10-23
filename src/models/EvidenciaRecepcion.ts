import { Schema, model, models, type InferSchemaType } from "mongoose";

// Foto de la mercancía rechazada o dañada al recibir una orden de compra. Se
// guarda en su propia colección (y no dentro de la orden) para que listar
// órdenes no arrastre megas de imágenes. El navegador la comprime antes de
// subirla, así que cada una pesa unos cientos de KB.

export const TAMANO_MAXIMO_EVIDENCIA = 900 * 1024;
export const EVIDENCIAS_POR_ORDEN = 20;

const EvidenciaRecepcionSchema = new Schema(
  {
    ordenCompraId: { type: Schema.Types.ObjectId, ref: "OrdenCompra", required: true, index: true },
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", default: null },
    nombreProducto: { type: String, default: "" },
    nota: { type: String, default: "", maxlength: 500 },
    mime: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true },
    datos: { type: Buffer, required: true, select: false },
    bytes: { type: Number, required: true },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * Con `.lean()` el campo llega como Binary de BSON y sin lean como Buffer; un
 * Buffer también tiene `.buffer`, pero es el ArrayBuffer compartido del pool,
 * así que no se puede tratar igual.
 */
export function bytesEvidencia(datos: unknown): Buffer {
  if (Buffer.isBuffer(datos)) return datos;
  const binario = datos as { buffer?: unknown } | null;
  if (binario?.buffer instanceof Uint8Array) return Buffer.from(binario.buffer);
  return Buffer.from(datos as Uint8Array);
}

export type EvidenciaRecepcion = InferSchemaType<typeof EvidenciaRecepcionSchema> & { _id: string };

export default models.EvidenciaRecepcion || model("EvidenciaRecepcion", EvidenciaRecepcionSchema);
