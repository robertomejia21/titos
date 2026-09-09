import { Schema, model, models, type InferSchemaType } from "mongoose";

export const ESTADOS_ORDEN_COMPRA = ["borrador", "solicitada", "recibida", "cancelada"] as const;

const OrdenCompraItemSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    nombreProducto: { type: String, required: true },
    cantidadRequerida: { type: Number, default: null },
    cantidadOrdenada: { type: Number, required: true },
    precioUnitario: { type: Number, default: 0 },
    notaRecepcion: { type: String, default: "", maxlength: 1000 },
    cantidadRecibida: { type: Number, default: null },
    necesidadId: { type: Schema.Types.ObjectId, ref: "NecesidadCompra", default: null },
    pedidosOrigen: [{ type: Schema.Types.ObjectId, ref: "Pedido" }],
  },
  { _id: false }
);

const OrdenCompraSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    proveedorId: { type: Schema.Types.ObjectId, ref: "Proveedor", required: true },
    estado: { type: String, enum: ESTADOS_ORDEN_COMPRA, default: "borrador" },
    items: { type: [OrdenCompraItemSchema], default: [] },
    fechaSolicitud: { type: Date, default: null },
    recibidoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fechaRecepcion: { type: Date, default: null },
    fechaCancelacion: { type: Date, default: null },
  },
  { timestamps: true }
);

export type OrdenCompra = InferSchemaType<typeof OrdenCompraSchema> & { _id: string };

export default models.OrdenCompra || model("OrdenCompra", OrdenCompraSchema);
