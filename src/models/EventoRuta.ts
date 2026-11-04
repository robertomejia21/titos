import { Schema, model, models, type InferSchemaType } from "mongoose";
import { TIPOS_EVENTO_RUTA } from "@/lib/logistica";

// Bitácora histórica de rutas: lo que pasó con cada salida después de cargar
// (paradas extraordinarias, llegadas, folios devueltos, mermas, escaneos). Es
// lo que se consulta en una auditoría o para rastrear una irregularidad.

const EventoRutaSchema = new Schema(
  {
    fecha: { type: String, required: true }, // YYYY-MM-DD del rol
    salidaId: { type: Schema.Types.ObjectId, default: null },
    salidaNombre: { type: String, default: "" },
    tipo: { type: String, enum: TIPOS_EVENTO_RUTA, required: true },
    detalle: { type: String, default: "", maxlength: 500 },
    folio: { type: String, default: "" },
    pedidoId: { type: Schema.Types.ObjectId, ref: "Pedido", default: null },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    porNombre: { type: String, default: "" },
    en: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

EventoRutaSchema.index({ fecha: 1, en: -1 });
EventoRutaSchema.index({ en: -1 });

export type EventoRuta = InferSchemaType<typeof EventoRutaSchema> & { _id: string };

export default models.EventoRuta || model("EventoRuta", EventoRutaSchema);
