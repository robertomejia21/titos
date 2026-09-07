import { Schema, model, models, type InferSchemaType } from "mongoose";

export const ESTADOS_CAJA = ["abierta", "cerrada"] as const;

const CajaSesionSchema = new Schema(
  {
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    // Ver `clienteOperacionId` en Venta: identifica el intento de apertura para
    // que un reintento tras una caída de red devuelva la misma sesión.
    clienteOperacionId: { type: String },
    estado: { type: String, enum: ESTADOS_CAJA, default: "abierta" },
    usuarioAperturaId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fechaApertura: { type: Date, default: Date.now },
    efectivoInicial: { type: Number, required: true, default: 0 },
    efectivoInicialUsd: { type: Number, default: 0 }, // fondo del cajón de dólares
    usuarioCierreId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fechaCierre: { type: Date, default: null },
    totalVentasEfectivo: { type: Number, default: null },
    totalVentasTarjeta: { type: Number, default: null },
    totalVentasTransferencia: { type: Number, default: null },
    totalVentasVales: { type: Number, default: null }, // vales de despensa recibidos: se cobran al emisor, no al cajón
    // Desglose de lo cobrado con tarjeta por terminal física, para cuadrar cada
    // depósito contra el estado de cuenta del banco que entregó la terminal.
    tarjetaPorTerminal: {
      type: [
        new Schema(
          {
            terminalId: { type: Schema.Types.ObjectId, ref: "TerminalPago", default: null },
            alias: { type: String, default: "" },
            monto: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Desglose de lo cobrado con tarjeta entre crédito, débito y American
    // Express: cada uno lo deposita el banco por separado y con su comisión.
    tarjetaPorTipo: {
      type: [
        new Schema(
          {
            tipo: { type: String, default: null },
            etiqueta: { type: String, default: "" },
            monto: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    totalVentasCredito: { type: Number, default: null }, // no es efectivo en caja, es cartera generada en el turno
    totalAbonosEfectivo: { type: Number, default: null }, // cobranza de clientes recibida en el turno
    totalDevoluciones: { type: Number, default: null }, // reembolsos pagados en el turno
    totalRetiros: { type: Number, default: null },
    efectivoEsperado: { type: Number, default: null },
    efectivoContado: { type: Number, default: null },
    diferencia: { type: Number, default: null },
    // Desglose de vales por emisor: a cada uno se le cobra por separado.
    valesPorEmisor: {
      type: [
        new Schema(
          {
            emisorId: { type: Schema.Types.ObjectId, ref: "EmisorVale", default: null },
            nombre: { type: String, default: "" },
            monto: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Cajón de dólares, independiente del de pesos
    totalVentasDolaresUsd: { type: Number, default: null }, // billetes de dólar que entraron por ventas
    totalVentasDolaresMxn: { type: Number, default: null }, // su valor en pesos al tipo de cambio del cobro
    totalCambioDolaresMxn: { type: Number, default: null }, // cambio que se devolvió en pesos por esos cobros
    totalRetirosUsd: { type: Number, default: null },
    efectivoEsperadoUsd: { type: Number, default: null },
    efectivoContadoUsd: { type: Number, default: null },
    diferenciaUsd: { type: Number, default: null },
    notas: { type: String, default: "" },
  },
  { timestamps: true }
);

CajaSesionSchema.index(
  { clienteOperacionId: 1 },
  { unique: true, partialFilterExpression: { clienteOperacionId: { $type: "string" } } }
);
CajaSesionSchema.index({ sucursalId: 1, estado: 1 });

export type CajaSesion = InferSchemaType<typeof CajaSesionSchema> & { _id: string };

export default models.CajaSesion || model("CajaSesion", CajaSesionSchema);
