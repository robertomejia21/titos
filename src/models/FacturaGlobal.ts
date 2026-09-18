import { Schema, model, models } from "mongoose";

const FacturaGlobalSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    dia: { type: String, required: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    alcance: { type: String, required: true },
    sucursalNombre: { type: String, required: true },
    zonaHoraria: { type: String, required: true },
    receptor: { type: String, default: "PUBLICO EN GENERAL" },
    rfc: { type: String, default: "XAXX010101000" },
    periodicidad: { type: String, default: "01" },
    mes: { type: String, required: true },
    anio: { type: Number, required: true },
    ventas: {
      type: [
        new Schema(
          {
            ventaId: {
              type: Schema.Types.ObjectId,
              ref: "Venta",
              required: true,
            },
            sucursalId: {
              type: Schema.Types.ObjectId,
              ref: "Sucursal",
              required: true,
            },
            sucursalNombre: { type: String, required: true },
            folio: { type: String, required: true },
            fecha: { type: Date, required: true },
            total: { type: Number, required: true },
            esVentas2: { type: Boolean, default: false },
            credito: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    total: { type: Number, required: true },
    conciliacion: {
      totalVentas: Number,
      individuales: Number,
      globalesAnteriores: Number,
    },
    estado: {
      type: String,
      enum: ["generada", "cancelada"],
      default: "generada",
    },
    creadoPorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    creadoPorNombre: { type: String, required: true },
    motivoCancelacion: { type: String, default: "" },
    canceladaEn: { type: Date, default: null },
    canceladaPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

FacturaGlobalSchema.index(
  { alcance: 1, dia: 1 },
  { unique: true, partialFilterExpression: { estado: "generada" } },
);
FacturaGlobalSchema.index({ "ventas.ventaId": 1, estado: 1 });
export default models.FacturaGlobal ||
  model("FacturaGlobal", FacturaGlobalSchema);
