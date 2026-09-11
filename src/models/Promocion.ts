import { Schema, model, models } from "mongoose";

const PromocionSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  tipo: { type: String, enum: ["porcentaje", "monto", "combinacion"], required: true },
  valor: { type: Number, required: true, min: 0 },
  alcance: { type: String, enum: ["productos", "categorias", "areas"], required: true },
  productos: [{ type: Schema.Types.ObjectId, ref: "Producto" }],
  categorias: [String],
  areas: [String],
  combinada: { type: Boolean, default: false },
  lleva: { type: Number, default: 2 },
  bonifica: { type: Number, default: 1 },
  porcentajeBeneficio: { type: Number, default: 100 },
  prioridad: { type: Number, default: 100 },
  sucursales: [{ type: Schema.Types.ObjectId, ref: "Sucursal" }],
  unidad: { type: String, enum: ["todas", "pieza", "kg"], required: true },
  inicio: { type: String, required: true },
  fin: { type: String, required: true },
  estado: { type: String, enum: ["borrador", "archivado", "activa"], default: "borrador" },
  revision: { type: Number, default: 0 },
  creadoPorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actualizadoPorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actualizadoPor: { type: String, required: true },
}, { timestamps: true });
PromocionSchema.index({ updatedAt: -1 });
export default models.Promocion || model("Promocion", PromocionSchema);
