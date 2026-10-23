import { Schema, model, models, type InferSchemaType } from "mongoose";
import { DIAS_SEMANA } from "@/lib/dias";

export const TIPOS_RUTA = ["primera_vuelta", "segunda_vuelta", "especial"] as const;
export const TIPOS_PARADA = ["sucursal", "recoleccion", "basura", "otro"] as const;

// Una parada del recorrido. Las de tipo "sucursal" son las que reciben
// pedidos; las demás (recoger carne en Bona Prime, huevo en Rancho Grande,
// cartón de Glorieta a Junior) son trabajo del chofer que también tiene que
// verse en la pantalla para que nadie lo olvide.
export const ParadaSchema = new Schema(
  {
    tipo: { type: String, enum: TIPOS_PARADA, required: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    descripcion: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const RutaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: TIPOS_RUTA, required: true },
    horaSalida: { type: String, required: true }, // HH:MM
    /** Cuánto ocupa a la unidad y al chofer; 0 = la duración general de la operación. */
    duracionMin: { type: Number, default: 0, min: 0, max: 720 },
    diasSemana: { type: [String], enum: DIAS_SEMANA, default: () => [...DIAS_SEMANA] },
    /** En orden de recorrido. */
    paradas: { type: [ParadaSchema], default: [] },
    requiereRefrigerado: { type: Boolean, default: false },
    vehiculoPreferidoId: { type: Schema.Types.ObjectId, ref: "Vehiculo", default: null },
    // Responsable nominal y su sustituto: el sugeridor los propone en ese orden
    // y solo rota a otro chofer si los dos están ocupados o inactivos.
    choferResponsableId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    choferSustitutoId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    notas: { type: String, default: "", trim: true },
    orden: { type: Number, default: 0 },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type Ruta = InferSchemaType<typeof RutaSchema> & { _id: string };

export default models.Ruta || model("Ruta", RutaSchema);
