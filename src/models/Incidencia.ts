import { Schema, model, models, type InferSchemaType } from "mongoose";
import { TIPOS_INCIDENCIA } from "@/lib/logistica";

// Algo que salió mal con una caja o un folio en el camino: llegó a la tienda
// equivocada, faltó, llegó dañada, se devolvió o hubo merma. Los comentarios
// se quedan aunque se resuelva, para que la auditoría vea qué se hizo (por
// ejemplo, "se reenvió a la sucursal correcta en la segunda vuelta").

const ComentarioSchema = new Schema(
  {
    en: { type: Date, default: Date.now },
    porNombre: { type: String, default: "" },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    texto: { type: String, required: true, maxlength: 1000 },
  },
  { _id: false }
);

const IncidenciaSchema = new Schema(
  {
    tipo: { type: String, enum: TIPOS_INCIDENCIA, required: true },
    estado: { type: String, enum: ["abierta", "resuelta"], default: "abierta" },
    pedidoId: { type: Schema.Types.ObjectId, ref: "Pedido", default: null },
    folio: { type: String, default: "" },
    cajaNumero: { type: String, default: "" },
    /** Tienda a la que iba el folio. */
    sucursalDestinoId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    /** Tienda donde se detectó (en "sucursal_incorrecta", la que la recibió por error). */
    sucursalDetectoId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    fechaRuta: { type: String, default: null },
    salidaId: { type: Schema.Types.ObjectId, default: null },
    creadaPorNombre: { type: String, default: "" },
    comentarios: { type: [ComentarioSchema], default: [] },
    resueltaEn: { type: Date, default: null },
    resueltaPorNombre: { type: String, default: "" },
  },
  { timestamps: true }
);

IncidenciaSchema.index({ estado: 1, createdAt: -1 });
IncidenciaSchema.index({ pedidoId: 1 });

export type Incidencia = InferSchemaType<typeof IncidenciaSchema> & { _id: string };

export default models.Incidencia || model("Incidencia", IncidenciaSchema);
