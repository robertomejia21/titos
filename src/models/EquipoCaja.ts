import { Schema, model, models } from "mongoose";

const schema = new Schema({
  sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true, unique: true },
  configuracion: { type: Schema.Types.Mixed, required: true },
  actualizadoPor: { type: String, required: true },
}, { timestamps: true });

export default models.EquipoCaja || model("EquipoCaja", schema);
