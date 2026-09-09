import { Schema, model, models } from "mongoose";

const ArqueoSchema = new Schema({
  sucursalId: { type: Schema.Types.ObjectId, required: true },
  cajaSesionId: { type: Schema.Types.ObjectId, required: true },
  usuarioId: { type: Schema.Types.ObjectId, required: true },
  supervisorId: { type: Schema.Types.ObjectId, required: true },
  supervisorNombre: { type: String, required: true },
  tokenHash: { type: String, required: true, select: false },
  estado: { type: String, enum: ["consulta", "guardado"], default: "consulta" },
  consultadoEn: { type: Date, required: true },
  venceEn: { type: Date, required: true },
  resumen: { type: Schema.Types.Mixed, required: true },
  efectivoInicial: Number,
  efectivoInicialUsd: Number,
  efectivoEsperado: Number,
  efectivoEsperadoUsd: Number,
  efectivoContado: Number,
  efectivoContadoUsd: Number,
  diferencia: Number,
  diferenciaUsd: Number,
  notas: { type: String, default: "", maxlength: 1000 },
  guardadoEn: Date,
}, { timestamps: true });
ArqueoSchema.index({ cajaSesionId: 1, consultadoEn: -1 });
export default models.Arqueo || model("Arqueo", ArqueoSchema);

const IntentoSchema = new Schema({ _id: String, cantidad: { type: Number, default: 0 }, expiraEn: Date });
IntentoSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });
export const IntentoArqueo = models.IntentoArqueo || model("IntentoArqueo", IntentoSchema);
