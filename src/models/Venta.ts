import { Schema, model, models, type InferSchemaType } from "mongoose";
import { TIPOS_TARJETA } from "@/lib/tarjetas";

// "credito" no entra dinero a la caja: genera una cuenta por cobrar del cliente.
// "vales" son vales de despensa: valen como pago de contado, pero no son
// efectivo del cajón (se cobran después al emisor del vale).
// "efectivo_usd" son dólares en billete: entran al cajón de dólares, y el cambio
// se devuelve en pesos (sale del cajón de pesos).
export const METODOS_PAGO = ["efectivo", "efectivo_usd", "tarjeta", "transferencia", "vales", "credito"] as const;
export const METODOS_PAGO_CONTADO = ["efectivo", "efectivo_usd", "tarjeta", "transferencia", "vales"] as const;
export const ESTADOS_VENTA = ["completada", "cancelada"] as const;

const VentaItemSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    sku: { type: String, required: true },
    nombreProducto: { type: String, required: true },
    unidad: { type: String, enum: ["pieza", "kg"], required: true },
    cantidad: { type: Number, required: true },
    precioUnitario: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    precioLista: Number,
    descuento: { type: Number, default: 0 },
    promocionId: { type: Schema.Types.ObjectId, ref: "Promocion", default: null },
    promocionNombre: { type: String, default: "" },
  },
  { _id: false }
);

const PagoVentaSchema = new Schema(
  {
    metodoPago: { type: String, enum: METODOS_PAGO, required: true },
    // Siempre en pesos: es la parte del total que cubre este pago. La suma de
    // todos los `monto` es igual al total de la venta, sin importar la moneda en
    // que se haya recibido físicamente el dinero.
    monto: { type: Number, required: true },

    // --- Solo para "efectivo_usd" ---
    // Dólares que el cliente entregó en billete (lo que realmente entra al
    // cajón de dólares). `montoUsd * tipoCambio - monto` es el cambio en pesos.
    montoUsd: { type: Number, default: null },
    // Tipo de cambio congelado al momento del cobro: el de configuración puede
    // cambiar mañana y el corte de hoy tiene que seguir cuadrando.
    tipoCambio: { type: Number, default: null },

    // --- Solo para "vales" ---
    // De qué emisor es el vale: cada uno se cobra por separado, así que el corte
    // tiene que poder desglosarlos. Del plástico solo se guardan el BIN y los
    // últimos 4, nunca el número completo.
    valeEmisorId: { type: Schema.Types.ObjectId, ref: "EmisorVale", default: null },
    valeEmisorNombre: { type: String, default: "" },
    valeUltimos4: { type: String, default: "" },

    // --- Solo para "tarjeta" ---
    // Con qué terminal física se cobró, para cuadrar contra el banco.
    terminalId: { type: Schema.Types.ObjectId, ref: "TerminalPago", default: null },
    terminalAlias: { type: String, default: "" },
    // Crédito, débito o American Express. El banco liquida cada uno por
    // separado y con su propia comisión, así que el corte tiene que poder
    // desglosarlos. `null` en las ventas anteriores a esta versión: se muestran
    // como "sin tipo identificado" en vez de inventarles uno.
    tarjetaTipo: { type: String, enum: [...TIPOS_TARJETA, null], default: null },
  },
  { _id: false }
);

const VentaSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    // Identificador que genera el punto de venta ANTES de mandar la venta, y que
    // no cambia entre reintentos. Es lo que evita el cobro doble cuando la red
    // se corta después de que el servidor ya registró la venta pero antes de que
    // la respuesta llegue al navegador: al reintentar, el servidor reconoce la
    // operación y devuelve la venta que ya existe en vez de crear otra.
    // Sin `default`: el campo simplemente no existe cuando no viene, y el índice
    // único de abajo es parcial. Un `default: null` con índice `sparse` NO
    // serviría: Mongo sí indexa los null explícitos, así que la segunda venta
    // sin este dato chocaría por clave duplicada.
    clienteOperacionId: { type: String },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    cajaSesionId: { type: Schema.Types.ObjectId, ref: "CajaSesion", required: true },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fecha: { type: Date, default: Date.now },
    corte: { type: String, required: true }, // YYYY-MM-DD, útil para cortes de caja futuros
    items: { type: [VentaItemSchema], default: [] },
    total: { type: Number, required: true },
    subtotalSinDescuento: Number,
    descuento: { type: Number, default: 0 },
    // Pago mixto: la suma de pagos[].monto debe ser igual a total. Puede incluir
    // más de un método (ej. una parte en efectivo y otra con tarjeta).
    pagos: { type: [PagoVentaSchema], required: true, default: [] },
    montoRecibido: { type: Number, default: null }, // efectivo entregado por el cliente (solo si hay un pago en efectivo)
    cambio: { type: Number, default: null },
    // Cliente frecuente al que se le facturó/fió la venta. Obligatorio cuando
    // hay un pago con método "credito".
    clienteId: { type: Schema.Types.ObjectId, ref: "Cliente", default: null },
    clienteNombre: { type: String, default: "" },
    creditoMonto: { type: Number, default: null },
    creditoFechaVencimiento: { type: Date, default: null },
    esVentas2: { type: Boolean, default: false },
    ventas2ActivacionId: { type: Schema.Types.ObjectId, ref: "Ventas2Activacion", default: null },
    ventas2SecuenciaEfectivo: { type: Number, default: null },
    estado: { type: String, enum: ESTADOS_VENTA, default: "completada" },
  },
  { timestamps: true }
);

// Único solo entre las ventas que traen el dato: las anteriores a esta versión
// no lo tienen y quedan fuera del índice.
VentaSchema.index(
  { clienteOperacionId: 1 },
  { unique: true, partialFilterExpression: { clienteOperacionId: { $type: "string" } } }
);
VentaSchema.index({ sucursalId: 1, createdAt: -1 });
VentaSchema.index({ sucursalId: 1, esVentas2: 1, corte: 1 });
VentaSchema.index({ ventas2ActivacionId: 1, estado: 1 });
VentaSchema.index({ clienteId: 1, createdAt: -1 });

export type Venta = InferSchemaType<typeof VentaSchema> & { _id: string };

export default models.Venta || model("Venta", VentaSchema);
