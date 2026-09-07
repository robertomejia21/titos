import { Schema, model, models, type InferSchemaType } from "mongoose";

const NecesidadCompraSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    nombreProducto: { type: String, required: true },
    cantidadRequerida: { type: Number, required: true },
    // "agotado_venta": una venta dejó el producto en cero en alguna tienda y la
    // alerta al área de compras lo empujó a esta lista (ver AlertaInventarioCero).
    motivo: { type: String, enum: ["faltante_pedido", "producto_nuevo", "manual", "agotado_venta"], required: true },
    pedidosOrigen: [{ type: Schema.Types.ObjectId, ref: "Pedido" }],
    estado: { type: String, enum: ["pendiente", "asignada"], default: "pendiente" },
    ordenCompraId: { type: Schema.Types.ObjectId, ref: "OrdenCompra", default: null },
  },
  { timestamps: true }
);

export type NecesidadCompra = InferSchemaType<typeof NecesidadCompraSchema> & { _id: string };

export default models.NecesidadCompra || model("NecesidadCompra", NecesidadCompraSchema);
