import { Schema, model, models } from "mongoose";

// Una caja de la sucursal = una computadora con su báscula, escáner y terminal.
//
// Antes había un solo registro por sucursal (sin `numeroCaja`); ese registro
// pasa a ser la Caja 1 (lib/cajaComputadora lo migra la primera vez).
const schema = new Schema({
  sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
  numeroCaja: { type: Number, default: 1, min: 1 },
  // Ficha técnica de los equipos (lib/equiposCaja). Vacía hasta que el técnico
  // la captura: una caja puede existir solo porque se le asignó computadora.
  configuracion: { type: Schema.Types.Mixed, default: null },
  actualizadoPor: { type: String, default: "" },
  // Computadora dueña de esta caja: hash del identificador que vive en su
  // cookie httpOnly. Null = caja sin computadora asignada.
  computadoraHash: { type: String, default: null },
  computadoraAsignadaEn: { type: Date, default: null },
  computadoraAsignadaPor: { type: String, default: "" },
  computadoraUltimaVez: { type: Date, default: null },
}, { timestamps: true });

schema.index({ sucursalId: 1, numeroCaja: 1 }, { unique: true });
// Una computadora es una sola caja.
schema.index({ computadoraHash: 1 }, { unique: true, partialFilterExpression: { computadoraHash: { $type: "string" } } });

export default models.EquipoCaja || model("EquipoCaja", schema);
