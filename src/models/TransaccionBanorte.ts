import { Schema, model, models, type InferSchemaType } from "mongoose";
import { COMANDOS_BANORTE, ESTADOS_TRANSACCION } from "@/lib/banorte";

// Cada operación que se le manda a la terminal Banorte: cobros, cancelaciones,
// devoluciones, reversas, verificaciones y cargas de llave. Se crea "pendiente"
// ANTES de mandar la orden al puente de caja, así que aunque el navegador se
// cierre a medio cobro queda registro del número de control con el que se
// puede preguntar a Payworks qué pasó.
//
// Nunca se guarda el número de la tarjeta: solo BIN y últimos 4.

const TransaccionBanorteSchema = new Schema(
  {
    // Único por afiliación según Payworks; aquí se hace único global, que es
    // más estricto y no cuesta nada.
    numeroControl: { type: String, required: true, unique: true },
    comando: { type: String, enum: COMANDOS_BANORTE, required: true },
    estado: { type: String, enum: ESTADOS_TRANSACCION, default: "pendiente" },
    monto: { type: Number, default: 0 },

    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    cajaSesionId: { type: Schema.Types.ObjectId, ref: "CajaSesion", default: null },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    terminalId: { type: Schema.Types.ObjectId, ref: "TerminalPago", default: null },
    terminalAlias: { type: String, default: "" },

    // A qué se amarra: la venta que cobró, o la venta/devolución que se está
    // cancelando o reembolsando, y la transacción original si es referenciada.
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", default: null },
    devolucionId: { type: Schema.Types.ObjectId, ref: "Devolucion", default: null },
    transaccionOriginalId: { type: Schema.Types.ObjectId, ref: "TransaccionBanorte", default: null },
    referenciaOriginal: { type: String, default: "" },
    // Lo genera el punto de venta para la venta; sirve para encontrar el cobro
    // aprobado si la venta no alcanzó a registrarse.
    clienteOperacionId: { type: String, default: "" },

    // --- Respuesta de Payworks / la terminal ---
    resultado: { type: String, default: "" }, // A D R T F E
    codigo: { type: String, default: "" },
    texto: { type: String, default: "" },
    autorizacion: { type: String, default: "" },
    referencia: { type: String, default: "" },
    afiliacion: { type: String, default: "" },
    tipoTarjeta: { type: String, default: "" },
    marca: { type: String, default: "" },
    banco: { type: String, default: "" },
    bin: { type: String, default: "" },
    ultimos4: { type: String, default: "" },
    modoEntrada: { type: String, default: "" },
    pinValidado: { type: Boolean, default: false },
    resultadoAutorizador: { type: String, default: "" },
    aid: { type: String, default: "" },
    tvr: { type: String, default: "" },
    appNombre: { type: String, default: "" },
    fechaSolicitud: { type: String, default: "" },
    fechaRespuesta: { type: String, default: "" },
    // PRD es cobro real; AUT/DEC/RND son modos de prueba de Payworks, que no
    // llegan al banco emisor. `simulado` es que el puente corrió sin la DLL.
    modo: { type: String, default: "" },
    simulado: { type: Boolean, default: false },
    respondidaEn: { type: Date, default: null },

    // Una venta o una devolución ya se amarró a esta transacción: no se puede
    // usar el mismo cobro para dos ventas.
    aplicada: { type: Boolean, default: false },
    // Cancelación o devolución en el banco que anuló este cobro.
    anuladaPorId: { type: Schema.Types.ObjectId, ref: "TransaccionBanorte", default: null },
    montoDevuelto: { type: Number, default: 0 },
    nota: { type: String, default: "" },
  },
  { timestamps: true }
);

TransaccionBanorteSchema.index({ sucursalId: 1, createdAt: -1 });
TransaccionBanorteSchema.index({ sucursalId: 1, estado: 1 });
TransaccionBanorteSchema.index({ ventaId: 1 });
TransaccionBanorteSchema.index({ referencia: 1 });
TransaccionBanorteSchema.index({ clienteOperacionId: 1 });

export type TransaccionBanorte = InferSchemaType<typeof TransaccionBanorteSchema> & { _id: string };

export default models.TransaccionBanorte || model("TransaccionBanorte", TransaccionBanorteSchema);
