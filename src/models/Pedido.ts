import { Schema, model, models, type InferSchemaType } from "mongoose";
import { ESTADOS_CAJA, ETAPAS_CARGA, PUNTOS_ESCANEO } from "@/lib/logistica";

export const ESTADOS_PEDIDO = ["pendiente", "nivelado", "surtido", "recibido"] as const;

/** Avisos automáticos que ya se mandaron por este pedido, para no repetirlos cada hora. */
export const TIPOS_ALERTA_PEDIDO = ["surtido_atrasado", "recepcion_atrasada"] as const;
export const ESTADOS_ALERTA_PEDIDO = ["enviada", "fallida", "sin_whatsapp"] as const;

const AlertaPedidoSchema = new Schema(
  {
    tipo: { type: String, enum: TIPOS_ALERTA_PEDIDO, required: true },
    enviadaEn: { type: Date, default: Date.now },
    estado: { type: String, enum: ESTADOS_ALERTA_PEDIDO, required: true },
    error: { type: String, default: "" },
    /** Horas de atraso que tenía el pedido cuando se disparó el aviso. */
    horasAtraso: { type: Number, default: 0 },
  },
  { _id: false }
);

const PedidoItemSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    nombreProducto: { type: String, required: true },
    categoria: { type: String, default: "" },
    unidad: { type: String, enum: ["pieza", "kg"], required: true },
    requierePesaje: { type: Boolean, default: false },
    precioVenta: { type: Number, default: 0 },
    cantidadPedida: { type: Number, required: true },
    cantidadAsignada: { type: Number, default: null },
    cantidadSurtida: { type: Number, default: null },
    pesoSurtidoKg: { type: Number, default: null },
    notaRecepcion: { type: String, default: "", maxlength: 1000 },
    cantidadRecibida: { type: Number, default: null },
    pesoRecibidoKg: { type: Number, default: null },
    // Lo que ya se mandó en segundas vueltas para completar este renglón. El
    // faltante pendiente es lo pedido menos lo surtido menos esto.
    cantidadComplementada: { type: Number, default: 0 },
  },
  { _id: false }
);

// Una caja física en la que se empaca y sella (con dos cinchos numerados)
// parte del surtido. Es información de trazabilidad adicional: no
// reemplaza la cantidad surtida por producto.
// Una lectura del QR de una caja (o del folio, si va sin cajas).
const EscaneoSchema = new Schema(
  {
    punto: { type: String, enum: PUNTOS_ESCANEO, required: true },
    en: { type: Date, default: Date.now },
    porNombre: { type: String, default: "" },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    /** "sucursal_incorrecta" cuando la tienda que escaneó no es la de destino. */
    resultado: { type: String, default: "ok" },
  },
  { _id: false }
);

// Las cajas que ya existían se capturaban selladas, por eso el default.
const CajaSchema = new Schema(
  {
    numero: { type: String, required: true },
    estado: { type: String, enum: ESTADOS_CAJA, default: "sellada" },
    /** Llave del QR de la caja; se genera al armarla (o al imprimir, en las viejas). */
    qr: { type: String, default: null },
    escaneos: { type: [EscaneoSchema], default: [] },
    cincho1: { type: String, default: "" },
    cincho2: { type: String, default: "" },
    categoria: { type: String, default: "" },
    items: [
      {
        _id: false,
        productoId: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
        nombreProducto: { type: String, required: true },
        cantidad: { type: Number, required: true },
      },
    ],
  },
  { _id: false, timestamps: true }
);

// Renglón de la tarjeta digital del folio: quién hizo qué y cuándo, incluidos
// los cambios de último momento (rearmar una caja, cambiar de salida).
const EventoPedidoSchema = new Schema(
  {
    tipo: { type: String, required: true },
    en: { type: Date, default: Date.now },
    porId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    porNombre: { type: String, default: "" },
    detalle: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const CargaSchema = new Schema(
  {
    etapa: { type: String, enum: ETAPAS_CARGA, default: "sin_cargar" },
    /** Día del rol (YYYY-MM-DD) y salida en la que va el folio. */
    fechaSalida: { type: String, default: null },
    salidaId: { type: Schema.Types.ObjectId, default: null },
    precargadoEn: { type: Date, default: null },
    cargadoEn: { type: Date, default: null },
    salioEn: { type: Date, default: null },
  },
  { _id: false }
);

const PedidoSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    fecha: { type: Date, required: true, default: Date.now },
    corte: { type: String, required: true }, // YYYY-MM-DD del corte de las 4pm al que pertenece
    estado: { type: String, enum: ESTADOS_PEDIDO, default: "pendiente" },
    // El chofer con el que salió. Se llena al pasar la salida a "en ruta"; antes
    // solo hay chofer programado en el rol. Conserva su nombre de campo porque
    // así lo guardan los pedidos que ya existían.
    repartidorId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    // Responsables operativos (personal del CEDIS, no usuarios del sistema).
    surtidorId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    cargadorId: { type: Schema.Types.ObjectId, ref: "Empleado", default: null },
    capturadoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    capturadoPorNombre: { type: String, default: "" },
    // 1 = el pedido que levantó la tienda. 2 = el complemento que sale en la
    // segunda vuelta con lo que faltó; apunta al original, que se conserva
    // intacto como referencia de lo que se pidió.
    vuelta: { type: Number, enum: [1, 2], default: 1 },
    pedidoOrigenId: { type: Schema.Types.ObjectId, ref: "Pedido", default: null },
    items: { type: [PedidoItemSchema], default: [] },
    cajas: { type: [CajaSchema], default: [] },

    // Quién movió el pedido en cada paso y cuándo. `updatedAt` no sirve para
    // esto: cambia con cualquier edición posterior, así que no se puede usar ni
    // para auditar ni para medir cuánto lleva atorado un pedido.
    niveladoEn: { type: Date, default: null },
    surtidoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    surtidoEn: { type: Date, default: null },
    recibidoPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    recibidoEn: { type: Date, default: null },

    carga: { type: CargaSchema, default: () => ({}) },
    /** QR del folio completo: lo que va sin cajas (frutas, verduras, carnicería). */
    qrToken: { type: String, default: null },
    escaneos: { type: [EscaneoSchema], default: [] },
    historial: { type: [EventoPedidoSchema], default: [] },

    alertas: { type: [AlertaPedidoSchema], default: [] },
  },
  { timestamps: true }
);

// El barrido de alertas busca pedidos atorados por estado y antigüedad.
PedidoSchema.index({ estado: 1, fecha: 1 });
PedidoSchema.index({ estado: 1, surtidoEn: 1 });
PedidoSchema.index({ pedidoOrigenId: 1 });
PedidoSchema.index({ qrToken: 1 }, { sparse: true });
PedidoSchema.index({ "cajas.qr": 1 }, { sparse: true });

export type Pedido = InferSchemaType<typeof PedidoSchema> & { _id: string };

export default models.Pedido || model("Pedido", PedidoSchema);
