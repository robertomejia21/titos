import { Schema, model, models, type InferSchemaType } from "mongoose";
import { REGIMENES_FISCALES_VALORES, USOS_CFDI_VALORES } from "@/lib/facturacion";
import { FORMAS_PAGO_SAT_VALORES, METODOS_PAGO_SAT_VALORES } from "@/lib/facturas";

// Factura del sistema: la nota de venta del punto de venta convertida a un
// documento con datos fiscales. Todavía NO se timbra ante el SAT; el bloque
// `timbrado` queda listo para la siguiente fase, cuando se contrate un PAC.

export const ESTADOS_FACTURA = ["generada", "cancelada"] as const;
export const ESTADOS_TIMBRADO = ["no_timbrada", "en_proceso", "timbrada", "error", "cancelada_sat"] as const;

const ConceptoSchema = new Schema(
  {
    productoId: { type: Schema.Types.ObjectId, ref: "Producto", default: null },
    // Claves del catálogo del SAT. Hoy se llenan con la genérica; cuando se
    // timbre se podrán mapear por producto sin cambiar la estructura.
    claveProdServ: { type: String, default: "01010101" },
    claveUnidad: { type: String, default: "H87" },
    sku: { type: String, default: "" },
    descripcion: { type: String, required: true },
    unidad: { type: String, default: "" },
    cantidad: { type: Number, required: true },
    valorUnitario: { type: Number, required: true },
    importe: { type: Number, required: true },
  },
  { _id: false }
);

const ReceptorSchema = new Schema(
  {
    razonSocial: { type: String, required: true, trim: true },
    rfc: { type: String, required: true, trim: true, uppercase: true },
    regimenFiscal: { type: String, enum: ["", ...REGIMENES_FISCALES_VALORES], default: "" },
    usoCfdi: { type: String, enum: ["", ...USOS_CFDI_VALORES], default: "" },
    codigoPostal: { type: String, default: "", trim: true },
    direccionFiscal: { type: String, default: "", trim: true },
    emailFacturacion: { type: String, default: "", trim: true, lowercase: true },
  },
  { _id: false }
);

const ComentarioSchema = new Schema(
  {
    texto: { type: String, required: true, trim: true },
    usuarioId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    usuarioNombre: { type: String, default: "" },
    fecha: { type: Date, default: Date.now },
  },
  { _id: true }
);

const TimbradoSchema = new Schema(
  {
    estado: { type: String, enum: ESTADOS_TIMBRADO, default: "no_timbrada" },
    uuid: { type: String, default: "" },
    fechaTimbrado: { type: Date, default: null },
    proveedor: { type: String, default: "" },
    error: { type: String, default: "" },
    // El XML timbrado es EL documento con valor fiscal; el PDF es solo su
    // representación impresa. Hay que conservarlo cinco años, así que se
    // guarda íntegro aquí y no se regenera nunca: un CFDI no se vuelve a armar,
    // se conserva tal como el SAT lo certificó.
    xml: { type: String, default: "" },
    selloCFDI: { type: String, default: "" },
    selloSAT: { type: String, default: "" },
    noCertificadoSAT: { type: String, default: "" },
    cadenaOriginalSAT: { type: String, default: "" },
    // QR de verificación que devuelve el PAC, en base64. Va en el PDF fiscal.
    qrCode: { type: String, default: "" },
    // Cancelación ante el SAT. Es distinta de la cancelación del sistema: esta
    // lleva motivo del catálogo (01 a 04) y deja acuse.
    motivoCancelacionSat: { type: String, default: "" },
    // Solo en el motivo 01: UUID de la factura que sustituye a esta.
    folioSustitucion: { type: String, default: "" },
    canceladoSatEn: { type: Date, default: null },
    acuseCancelacion: { type: String, default: "" },
  },
  { _id: false }
);

const FacturaSchema = new Schema(
  {
    folio: { type: String, required: true, unique: true },
    serie: { type: String, default: "A" },
    // Una venta solo puede tener una factura vigente a la vez. No es un índice
    // único porque, si la factura se cancela, la venta se puede volver a
    // facturar (por ejemplo, cuando los datos fiscales venían mal).
    ventaId: { type: Schema.Types.ObjectId, ref: "Venta", required: true },
    ventaFolio: { type: String, required: true },
    ventaFecha: { type: Date, default: null },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    sucursalNombre: { type: String, default: "" },
    clienteId: { type: Schema.Types.ObjectId, ref: "Cliente", default: null },
    receptor: { type: ReceptorSchema, required: true },
    conceptos: { type: [ConceptoSchema], default: [] },
    tasaIva: { type: Number, default: 0 },
    subtotal: { type: Number, required: true },
    iva: { type: Number, default: 0 },
    total: { type: Number, required: true },
    formaPago: { type: String, enum: FORMAS_PAGO_SAT_VALORES, default: "99" },
    metodoPago: { type: String, enum: METODOS_PAGO_SAT_VALORES, default: "PUE" },
    comentarios: { type: [ComentarioSchema], default: [] },
    estado: { type: String, enum: ESTADOS_FACTURA, default: "generada" },
    motivoCancelacion: { type: String, default: "" },
    canceladaEn: { type: Date, default: null },
    canceladaPorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    timbrado: { type: TimbradoSchema, default: () => ({}) },
    creadoPorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    creadoPorNombre: { type: String, default: "" },
    corte: { type: String, default: "" }, // YYYY-MM-DD de emisión, en la zona de la sucursal
  },
  { timestamps: true }
);

FacturaSchema.index({ ventaId: 1, estado: 1 });
FacturaSchema.index({ sucursalId: 1, createdAt: -1 });
FacturaSchema.index({ "receptor.rfc": 1 });
FacturaSchema.index({ corte: 1 });
// Para localizar una factura por su UUID fiscal, que es como la identifican el
// SAT, el receptor y el PAC. Disperso porque la mayoría no está timbrada.
FacturaSchema.index({ "timbrado.uuid": 1 }, { sparse: true });

export type Factura = InferSchemaType<typeof FacturaSchema> & { _id: string };

export default models.Factura || model("Factura", FacturaSchema);
