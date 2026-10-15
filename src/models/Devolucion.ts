import { Schema, model, models, type InferSchemaType } from "mongoose";

export const ESTADOS_DEVOLUCION = ["pendiente", "pagada", "cancelada"] as const;

/** Ventana máxima para devolver, en horas, contada desde la hora de la venta. */
export const HORAS_LIMITE_DEVOLUCION = 48;

const DevolucionItemSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    sku: { type: String, required: true },
    nombreProducto: { type: String, required: true },
    unidad: { type: String, enum: ["pieza", "kg"], required: true },
    cantidad: { type: Number, required: true },
    precioUnitario: { type: Number, required: true },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

// Una devolución nace "pendiente" cuando el corte del día de la venta ya se
// cerró: no se puede sacar efectivo de una caja cerrada. Se paga después contra
// la caja abierta y ahí entra al corte.

const DevolucionSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", required: true },
    ventaFolio: { type: String, required: true },
    ventaFecha: { type: Date, required: true },
    clienteId: { type: Schema.Types.ObjectId, ref: "Cliente", default: null },
    clienteNombre: { type: String, default: "" },
    items: { type: [DevolucionItemSchema], default: [] },
    total: { type: Number, required: true },
    // Parte que se abate de la cuenta por cobrar del cliente (ventas a crédito)
    // y parte que se le reembolsa en efectivo.
    montoCredito: { type: Number, default: 0 },
    montoEfectivo: { type: Number, default: 0 },
    // Parte que regresa a la tarjeta con una DEVOLUCION en Banorte (solo si la
    // venta se cobró con la terminal integrada). No sale del cajón.
    montoTarjeta: { type: Number, default: 0 },
    tarjeta: {
      type: new Schema(
        {
          // pendiente: la devolución se capturó y falta mandarla a la terminal.
          // aprobada: Banorte la aplicó. A falta de aprobación, el monto pasa a
          // efectivo y aquí queda "convertida_efectivo".
          estado: { type: String, enum: ["pendiente", "aprobada", "convertida_efectivo"], default: "pendiente" },
          transaccionOriginalId: { type: Schema.Types.ObjectId, ref: "TransaccionBanorte", default: null },
          referenciaOriginal: { type: String, default: "" },
          numeroControl: { type: String, default: "" },
          referencia: { type: String, default: "" },
          autorizacion: { type: String, default: "" },
          ultimos4: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: null,
    },
    estado: { type: String, enum: ESTADOS_DEVOLUCION, default: "pendiente" },
    motivo: { type: String, default: "" },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fecha: { type: Date, default: Date.now },
    corte: { type: String, required: true }, // YYYY-MM-DD en que se capturó
    // Datos del pago del reembolso (cuándo salió el efectivo del cajón)
    cajaSesionId: { type: Schema.Types.ObjectId, ref: "CajaSesion", default: null },
    cortePago: { type: String, default: null },
    pagadaEn: { type: Date, default: null },
    pagadaPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

DevolucionSchema.index({ sucursalId: 1, fecha: -1 });
DevolucionSchema.index({ sucursalId: 1, estado: 1 });
DevolucionSchema.index({ ventaId: 1 });
DevolucionSchema.index({ cajaSesionId: 1 });

export type Devolucion = InferSchemaType<typeof DevolucionSchema> & { _id: string };

export default models.Devolucion || model("Devolucion", DevolucionSchema);
