import { Schema, model, models, type InferSchemaType } from "mongoose";

export const TIPOS_VEHICULO = ["estaquita", "camion"] as const;

const VehiculoSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: TIPOS_VEHICULO, required: true },
    // Lo perecedero (carnes, lácteos, Home Chef) solo puede salir en una
    // unidad refrigerada; el sugeridor del rol lo respeta.
    refrigerado: { type: Boolean, default: false },
    placas: { type: String, default: "", trim: true },
    notas: { type: String, default: "", trim: true },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type Vehiculo = InferSchemaType<typeof VehiculoSchema> & { _id: string };

export default models.Vehiculo || model("Vehiculo", VehiculoSchema);
