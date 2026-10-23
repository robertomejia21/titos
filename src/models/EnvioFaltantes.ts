import { Schema, model, models, type InferSchemaType } from "mongoose";

// Constancia del envío diario de faltantes: el cron corre cada hora y esto es
// lo que evita mandar la misma lista dos veces el mismo día.
const EnvioFaltantesSchema = new Schema(
  {
    fecha: { type: String, required: true, unique: true }, // YYYY-MM-DD en la zona del CEDIS
    enviadoEn: { type: Date, default: Date.now },
    origen: { type: String, enum: ["cron", "manual"], default: "cron" },
    mensajesEnviados: { type: Number, default: 0 },
    mensajesFallidos: { type: Number, default: 0 },
    errores: { type: [String], default: [] },
  },
  { timestamps: true }
);

export type EnvioFaltantes = InferSchemaType<typeof EnvioFaltantesSchema> & { _id: string };

export default models.EnvioFaltantes || model("EnvioFaltantes", EnvioFaltantesSchema);
