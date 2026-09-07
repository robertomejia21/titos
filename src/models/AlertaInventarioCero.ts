import { Schema, model, models, type InferSchemaType } from "mongoose";

// Aviso al área de compras de que una venta dejó un producto en cero.
//
// El punto de venta no deja vender por debajo de la existencia, así que el
// momento en que hay que enterarse no es "se vendió algo que no había" sino
// "se acaba de vender la última pieza": a partir de ahí la tienda pierde venta
// hasta que llegue resurtido. Compras necesita ese aviso el mismo día, no en el
// corte de la semana.
//
// Cada alerta se queda abierta hasta que alguien la marca como atendida (o hasta
// que vuelve a entrar mercancía), y mientras esté abierta no se genera otra del
// mismo producto en la misma tienda: si no, un producto agotado dispararía un
// WhatsApp por cada cliente que pregunta por él.

const AlertaInventarioCeroSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    sku: { type: String, default: "" },
    nombreProducto: { type: String, default: "" },
    unidad: { type: String, default: "" },
    // Dónde se agotó. El mostrador de matriz cuenta como una tienda más.
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    sucursalNombre: { type: String, default: "" },
    esMatriz: { type: Boolean, default: false },
    // Venta que se llevó las últimas piezas.
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", default: null },
    ventaFolio: { type: String, default: "" },
    cantidadVendida: { type: Number, default: 0 },
    /** Existencia que quedó: 0 al agotarse, negativa si se vendió de más. */
    stockResultante: { type: Number, default: 0 },
    // El punto de venta cobra aunque el sistema no tenga existencia (el producto
    // está en el mostrador y el cliente lo tiene en la mano). Cuando eso pasa,
    // además de resurtir hay que ajustar el inventario, y no es lo mismo que un
    // agotado normal: por eso se distingue.
    vendidoSinExistencia: { type: Boolean, default: false },
    fecha: { type: Date, default: Date.now },
    estado: { type: String, enum: ["abierta", "atendida"], default: "abierta" },
    // Cómo le fue al WhatsApp. Un aviso que no salió no cierra la alerta: se
    // sigue viendo en la pantalla de compras, que es la red de seguridad.
    notificada: { type: Boolean, default: false },
    errorNotificacion: { type: String, default: "" },
    atendidaEn: { type: Date, default: null },
    atendidaPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    atendidaPorNombre: { type: String, default: "" },
  },
  { timestamps: true }
);

// Una sola alerta abierta por producto y tienda: es lo que evita el aluvión de
// mensajes mientras el producto sigue agotado.
AlertaInventarioCeroSchema.index(
  { productoId: 1, sucursalId: 1 },
  { unique: true, partialFilterExpression: { estado: "abierta" } }
);
AlertaInventarioCeroSchema.index({ estado: 1, fecha: -1 });

export type AlertaInventarioCero = InferSchemaType<typeof AlertaInventarioCeroSchema> & { _id: string };

export default models.AlertaInventarioCero || model("AlertaInventarioCero", AlertaInventarioCeroSchema);
