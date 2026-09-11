import { Schema, model, models, type InferSchemaType } from "mongoose";

const ProductoSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    alias: { type: [String], default: [] }, // nombres alternativos para localizar el producto en búsquedas
    fiscal: { type: new Schema({
      iva: { type: String, enum: ["pendiente", "exento", "0", "8", "16"] },
      iepsTipo: { type: String, enum: ["pendiente", "no_aplica", "porcentaje", "cuota"] },
      iepsValor: Number,
      claveProdServ: String,
      precioImpuestos: { type: String, enum: ["pendiente", "sin_impuestos", "incluidos"] },
    }, { _id: false }), default: undefined },
    area: { type: String, trim: true, default: "" },
    linea: { type: String, trim: true, default: "" },
    categoria: { type: String, required: true, trim: true },
    anaquel: { type: String, trim: true, default: "" }, // ubicación física donde se acomoda en el CEDIS matriz

    unidad: { type: String, enum: ["pieza", "kg"], required: true },
    requierePesaje: { type: Boolean, default: false },
    precioCompra: { type: Number, required: true, default: 0 },
    precioVenta: { type: Number, required: true, default: 0 },
    existenciaMatriz: { type: Number, required: true, default: 0 },
    stockMinimo: { type: Number, default: 0 },
    stockMaximo: { type: Number, default: 0 },
    proveedorPreferidoId: { type: Schema.Types.ObjectId, ref: "Proveedor", default: null },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Acelera el listado paginado del catálogo (find({activo:true}).sort({nombre:1})).
ProductoSchema.index({ activo: 1, nombre: 1 });
// Para recorrer el CEDIS acomodando/surtiendo por ubicación en vez de por nombre.
ProductoSchema.index({ activo: 1, anaquel: 1 });

export type Producto = InferSchemaType<typeof ProductoSchema> & { _id: string };

export default models.Producto || model("Producto", ProductoSchema);
