import { Schema, model, models, type InferSchemaType } from "mongoose";

// Una tienda (Progreso, por ejemplo) pide al CEDIS una entrega con datos
// completos: pedido, dirección, zona y horario. El CEDIS la confirma en una
// salida del rol o propone otro horario, y la tienda acepta o cancela.

export const ESTADOS_SOLICITUD_RUTA = ["pendiente", "reprogramada", "confirmada", "entregada", "cancelada"] as const;
export const TIPOS_FRIO = ["ninguno", "refrigerado", "congelado"] as const;

const EventoSolicitudSchema = new Schema(
  {
    en: { type: Date, default: Date.now },
    porNombre: { type: String, default: "" },
    texto: { type: String, required: true, maxlength: 500 },
  },
  { _id: false }
);

const SolicitudRutaSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    pedidoId: { type: Schema.Types.ObjectId, ref: "Pedido", default: null },
    direccion: { type: String, required: true, trim: true, maxlength: 300 },
    zona: { type: String, default: "", trim: true, maxlength: 80 },
    fecha: { type: String, required: true }, // YYYY-MM-DD deseada
    horaDesde: { type: String, required: true }, // HH:MM
    horaHasta: { type: String, required: true },
    frio: { type: String, enum: TIPOS_FRIO, default: "ninguno" },
    notas: { type: String, default: "", trim: true, maxlength: 500 },
    estado: { type: String, enum: ESTADOS_SOLICITUD_RUTA, default: "pendiente" },
    /** Lo que propone el CEDIS cuando no puede en el horario pedido. */
    propuesta: {
      type: new Schema({ fecha: String, horaDesde: String, horaHasta: String, comentario: String }, { _id: false }),
      default: null,
    },
    /** Salida del rol en la que va, con lo que había al confirmar. */
    confirmacion: {
      type: new Schema(
        { fecha: String, salidaId: Schema.Types.ObjectId, salidaNombre: String, horaSalida: String, choferNombre: String, vehiculoNombre: String },
        { _id: false }
      ),
      default: null,
    },
    historial: { type: [EventoSolicitudSchema], default: [] },
  },
  { timestamps: true }
);

SolicitudRutaSchema.index({ estado: 1, fecha: 1 });
SolicitudRutaSchema.index({ sucursalId: 1, createdAt: -1 });

export type SolicitudRuta = InferSchemaType<typeof SolicitudRutaSchema> & { _id: string };

export default models.SolicitudRuta || model("SolicitudRuta", SolicitudRutaSchema);
