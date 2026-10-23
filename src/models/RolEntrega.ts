import { Schema, model, models, type InferSchemaType } from "mongoose";
import { ParadaSchema, TIPOS_RUTA } from "@/models/Ruta";

export const ESTADOS_SALIDA = ["programada", "en_ruta", "completada"] as const;

// Una salida del día: qué ruta, en qué unidad, con qué chofer y qué folios
// lleva. Se guarda una copia de los datos de la ruta (nombre, hora, paradas)
// para que editar el catálogo no reescriba lo que ya salió.
const SalidaSchema = new Schema(
  {
    rutaId: { type: Schema.Types.ObjectId, ref: "Ruta", default: null },
    nombre: { type: String, required: true },
    tipo: { type: String, enum: TIPOS_RUTA, required: true },
    horaSalida: { type: String, required: true },
    duracionMin: { type: Number, default: 0 },
    requiereRefrigerado: { type: Boolean, default: false },
    vehiculoId: { type: Schema.Types.ObjectId, ref: "Vehiculo", default: null },
    choferId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    paradas: { type: [ParadaSchema], default: [] },
    pedidoIds: [{ type: Schema.Types.ObjectId, ref: "Pedido" }],
    estado: { type: String, enum: ESTADOS_SALIDA, default: "programada" },
    /** Por qué el sistema propuso esta unidad y este chofer, para quien ajusta. */
    motivoSugerencia: { type: String, default: "" },
    /** true cuando alguien cambió a mano lo que propuso el sistema. */
    ajustadaManualmente: { type: Boolean, default: false },
    notas: { type: String, default: "", trim: true },
  },
  { _id: true }
);

const RolEntregaSchema = new Schema(
  {
    fecha: { type: String, required: true, unique: true }, // YYYY-MM-DD en la zona del CEDIS
    salidas: { type: [SalidaSchema], default: [] },
    generadoEn: { type: Date, default: null },
    actualizadoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actualizadoPorNombre: { type: String, default: "" },
  },
  { timestamps: true }
);

export type RolEntrega = InferSchemaType<typeof RolEntregaSchema> & { _id: string };

export default models.RolEntrega || model("RolEntrega", RolEntregaSchema);
