import { Schema, model, models, type InferSchemaType } from "mongoose";

const MovimientoInventarioSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: [
        "entrada_proveedor",
        "salida_matriz_a_sucursal",
        "entrada_sucursal",
        "salida_venta",
        "entrada_devolucion",
        // Préstamos entre sucursales: el stock sale de quien presta y entra a
        // quien recibe; al devolver se hace el movimiento inverso.
        "salida_prestamo",
        "entrada_prestamo",
        "salida_devolucion_prestamo",
        "entrada_devolucion_prestamo",
      ],
      required: true,
    },
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    nombreProducto: { type: String, required: true },
    ubicacion: { type: String, required: true }, // "matriz" o sucursalId como string
    notaRecepcion: { type: String, default: "", maxlength: 1000 },
    cantidad: { type: Number, required: true },
    pesoKg: { type: Number, default: null },
    pedidoId: { type: Schema.Types.ObjectId, ref: "Pedido", default: null },
    ordenCompraId: { type: Schema.Types.ObjectId, ref: "OrdenCompra", default: null },
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", default: null },
    devolucionId: { type: Schema.Types.ObjectId, ref: "Devolucion", default: null },
    prestamoId: { type: Schema.Types.ObjectId, ref: "PrestamoSucursal", default: null },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fecha: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export type MovimientoInventario = InferSchemaType<typeof MovimientoInventarioSchema> & { _id: string };

export default models.MovimientoInventario ||
  model("MovimientoInventario", MovimientoInventarioSchema);
