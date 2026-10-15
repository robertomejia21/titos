import { Schema, model, models, type InferSchemaType } from "mongoose";

// Terminal punto de venta (TPV) física con la que una sucursal cobra con
// tarjeta. Por omisión el sistema no habla con la terminal: solo registra con
// cuál se cobró, para poder cuadrar cada depósito contra el estado de cuenta del
// banco que la entregó y detectar cuál está fallando.
//
// Si `cobroIntegrado` está prendido, el punto de venta le manda el cobro a la
// terminal Banorte por medio del puente de caja (ver src/lib/banorte.ts) y la
// autorización regresa sola. La IP, el puerto y la contraseña de Payworks no
// viven aquí sino en la PC de caja.

const TerminalPagoSchema = new Schema(
  {
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    // Como le dice el cajero: "Azul", "La de la caja 2". Es lo que se elige al cobrar.
    alias: { type: String, required: true, trim: true },
    banco: { type: String, default: "", trim: true },
    marca: { type: String, default: "", trim: true },
    // Serie o número de afiliación impreso en la terminal: es el dato con el que
    // el banco identifica los depósitos.
    numeroSerie: { type: String, default: "", trim: true },
    // Cobro automático con Banorte Payworks (Interredes Remoto).
    cobroIntegrado: { type: Boolean, default: false },
    // Afiliación Banorte: sale en el voucher y se compara con la que contesta
    // Payworks, para detectar un puente apuntando a otra terminal.
    afiliacion: { type: String, default: "", trim: true },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Dos terminales de la misma sucursal no pueden llamarse igual: el alias es lo
// único que ve el cajero al momento de cobrar.
TerminalPagoSchema.index({ sucursalId: 1, alias: 1 }, { unique: true });
TerminalPagoSchema.index({ sucursalId: 1, activo: 1 });

export type TerminalPago = InferSchemaType<typeof TerminalPagoSchema> & { _id: string };

export default models.TerminalPago || model("TerminalPago", TerminalPagoSchema);
