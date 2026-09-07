import { Schema, model, models, type InferSchemaType } from "mongoose";

// Bitácora de todo lo que se cancela en un punto de venta (matriz o sucursal).
// Existe para que matriz pueda auditar qué se está quitando de las ventas, quién
// lo hizo y si alguien lo autorizó con el NIP de supervisor.

export const TIPOS_CANCELACION = ["linea", "carrito", "venta"] as const;

const CancelacionItemSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", default: null },
    sku: { type: String, default: "" },
    nombreProducto: { type: String, default: "" },
    unidad: { type: String, default: "" },
    cantidad: { type: Number, default: 0 },
    precioUnitario: { type: Number, default: 0 },
    importe: { type: Number, default: 0 },
  },
  { _id: false }
);

const CancelacionPosSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    // "linea": se quitó un producto del carrito.
    // "carrito": se vació o se canceló la venta antes de cobrarla.
    // "venta": se canceló una venta ya cobrada (devuelve stock).
    tipo: { type: String, enum: TIPOS_CANCELACION, required: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    sucursalNombre: { type: String, default: "" },
    esMatriz: { type: Boolean, default: false },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    usuarioNombre: { type: String, default: "" },
    cajaSesionId: { type: Schema.Types.ObjectId, ref: "CajaSesion", default: null },
    // Solo para tipo "venta".
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", default: null },
    ventaFolio: { type: String, default: "" },
    items: { type: [CancelacionItemSchema], default: [] },
    importe: { type: Number, default: 0 },
    motivo: { type: String, required: true, trim: true },
    // false cuando todavía no se configura ningún NIP: la cancelación se permite
    // igual, pero queda marcada como no autorizada.
    autorizadoConNip: { type: Boolean, default: false },
    // Encargado de turno que puso su NIP personal. Vacío cuando se autorizó con
    // el NIP general de la configuración, que no identifica a nadie.
    autorizadoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    autorizadoPorNombre: { type: String, default: "" },
    fecha: { type: Date, default: Date.now },
    corte: { type: String, required: true }, // YYYY-MM-DD en la zona de la sucursal
  },
  { timestamps: true }
);

CancelacionPosSchema.index({ sucursalId: 1, fecha: -1 });
CancelacionPosSchema.index({ corte: 1 });
CancelacionPosSchema.index({ tipo: 1, fecha: -1 });

export type CancelacionPos = InferSchemaType<typeof CancelacionPosSchema> & { _id: string };

export default models.CancelacionPos || model("CancelacionPos", CancelacionPosSchema);
