import { Schema, model, models, type InferSchemaType } from "mongoose";

// Los dólares viven en su propio cajón: un retiro en USD no toca el efectivo en pesos.
export const MONEDAS_CAJA = ["MXN", "USD"] as const;

const MovimientoCajaSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    // Ver `clienteOperacionId` en Venta: evita que un reintento tras una caída
    // de red registre el mismo retiro dos veces.
    clienteOperacionId: { type: String },
    cajaSesionId: { type: Schema.Types.ObjectId, ref: "CajaSesion", required: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    tipo: { type: String, enum: ["retiro"], default: "retiro" },
    moneda: { type: String, enum: MONEDAS_CAJA, default: "MXN" },
    monto: { type: Number, required: true },
    motivo: { type: String, required: true },
    // Usuario que capturó el retiro y sacó el dinero del cajón.
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    usuarioNombre: { type: String, default: "" },
    // Encargado de turno que lo autorizó con su NIP de 6 dígitos. Vacío cuando
    // el cajero se autorizó a sí mismo con su propia clave de acceso, que es lo
    // que se hacía antes de que existieran los NIP personales.
    autorizadoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    autorizadoPorNombre: { type: String, default: "" },
    fecha: { type: Date, default: Date.now },
    corte: { type: String, required: true }, // YYYY-MM-DD
  },
  { timestamps: true }
);

MovimientoCajaSchema.index(
  { clienteOperacionId: 1 },
  { unique: true, partialFilterExpression: { clienteOperacionId: { $type: "string" } } }
);
MovimientoCajaSchema.index({ sucursalId: 1, fecha: -1 });
MovimientoCajaSchema.index({ cajaSesionId: 1 });

export type MovimientoCaja = InferSchemaType<typeof MovimientoCajaSchema> & { _id: string };

export default models.MovimientoCaja || model("MovimientoCaja", MovimientoCajaSchema);
