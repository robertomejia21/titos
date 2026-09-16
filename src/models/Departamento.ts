import { Schema, model, models } from "mongoose";

const DepartamentoSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 80 },
  clave: { type: String, required: true, unique: true },
  descripcion: { type: String, default: "", maxlength: 300 },
  activo: { type: Boolean, default: true },
}, { timestamps: true });

export default models.Departamento || model("Departamento", DepartamentoSchema);
