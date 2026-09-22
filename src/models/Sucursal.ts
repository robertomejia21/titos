import { Schema, model, models, type InferSchemaType } from "mongoose";
import { ZONA_HORARIA_DEFAULT, ZONAS_HORARIAS } from "@/lib/zonasHorarias";

const SucursalSchema = new Schema(
  {
    nombre: { type: String, required: true },
    clave: { type: String, trim: true, unique: true, sparse: true },
    direccion: { type: String, default: "" },
    // CP de la tienda. Es el LugarExpedicion del CFDI: el SAT quiere el lugar
    // donde se emitió, no el domicilio fiscal de la empresa. Vacío = se usa el
    // CP del emisor, que es lo correcto mientras solo factura matriz.
    codigoPostal: { type: String, default: "", trim: true },
    whatsapp: { type: String, default: "" },
    zonaHoraria: { type: String, enum: ZONAS_HORARIAS.map((z) => z.value), default: ZONA_HORARIA_DEFAULT },
    // El mostrador de la matriz: la matriz también vende al público que llega al
    // CEDIS. Es una sucursal más para caja/ventas/cortes, pero su inventario es
    // la existencia del CEDIS (Producto.existenciaMatriz), no un InventarioSucursal.
    esMatriz: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type Sucursal = InferSchemaType<typeof SucursalSchema> & { _id: string };

export default models.Sucursal || model("Sucursal", SucursalSchema);
