import { Schema, model, models, type InferSchemaType } from "mongoose";
import { DIAS_SEMANA } from "@/lib/dias";

// Reglas con las que el punto de venta recibe dólares en billete.
const ConfiguracionDolaresSchema = new Schema(
  {
    aceptaPagos: { type: Boolean, default: true },
    // 0 = se aceptan todas las denominaciones, que es la política actual. Al
    // poner un tope (por ejemplo 50) el punto de venta le avisa al cajero que no
    // debe recibir billetes por encima de esa denominación. Es configurable a
    // propósito: el día que el negocio decida rechazar los de 100 se cambia
    // aquí, sin tocar código ni volver a desplegar.
    denominacionMaxima: { type: Number, default: 0, min: 0 },
    // Tope de cuánto de una venta puede pagarse en billete verde. Existen los
    // dos porque son topes distintos y la tienda usa el que le aplique: el
    // porcentaje protege el ticket grande (no aceptar que una compra de 20 mil
    // se liquide entera en dólares) y el monto protege el cajón (no quedarse
    // con más billetes de los que se pueden cambiar en el día).
    // 0 en cualquiera de los dos = ese tope no aplica.
    /** Máximo del total de la venta que puede cubrirse con dólares, en %. */
    porcentajeMaximo: { type: Number, default: 0, min: 0, max: 100 },
    /** Máximo de dólares en billete que se reciben en una sola venta. */
    montoMaximoUsd: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Avisos automáticos de pedidos que se quedaron atorados. Los dispara el
// barrido de /api/cron/alertas.
const ConfiguracionAlertasSchema = new Schema(
  {
    activas: { type: Boolean, default: true },
    /** Horas desde que la sucursal levantó el pedido para que matriz lo surta. */
    horasLimiteSurtido: { type: Number, default: 24, min: 1 },
    /** Horas desde que matriz surtió para que la sucursal confirme la recepción. */
    horasLimiteRecepcion: { type: Number, default: 24, min: 1 },
    /**
     * WhatsApp de quienes reciben los avisos de surtido atrasado (matriz). Los
     * de recepción atrasada van al WhatsApp de la sucursal correspondiente.
     */
    destinatarios: { type: [String], default: [] },
    /**
     * Aviso al área de compras cuando una venta deja un producto en cero. Va a
     * su propia lista de WhatsApp: quien surte pedidos no es quien compra.
     */
    inventarioCeroActiva: { type: Boolean, default: true },
    destinatariosCompras: { type: [String], default: [] },
  },
  { _id: false }
);

const ConfiguracionSchema = new Schema(
  {
    diasLaborales: { type: [String], enum: DIAS_SEMANA, default: ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] },
    horaCorte: { type: String, default: "16:00" },
    tipoCambio: { type: Number, default: 17 },
    fondoCajaMxn: { type: Number, default: 1000, min: 0, max: 1000000 },
    // Quién y cuándo movió el tipo de cambio por última vez. El punto de venta
    // lo muestra junto al importe en dólares: un tipo de cambio de hace tres
    // semanas regala mercancía y nadie se entera hasta el corte.
    tipoCambioActualizadoEn: { type: Date, default: null },
    tipoCambioActualizadoPor: { type: String, default: "" },
    dolares: { type: ConfiguracionDolaresSchema, default: () => ({}) },
    alertas: { type: ConfiguracionAlertasSchema, default: () => ({}) },
    // NIP con el que un supervisor autoriza las cancelaciones en los puntos de
    // venta (matriz y sucursales). Se guarda hasheado y nunca se devuelve por la
    // API: solo se informa si ya está configurado.
    nipSupervisorHash: { type: String, default: "" },
    // NIP de 6 dígitos que hay que capturar para poder dar de alta (o ascender
    // a) un usuario con rol de supervisor. Es un candado aparte del NIP de
    // cancelaciones a propósito: ese lo conocen los supervisores del mostrador,
    // y con él no debe poder crearse otro supervisor. También se guarda
    // hasheado y la API solo informa si ya está configurado.
    nipCreacionSupervisorHash: { type: String, default: "" },
    // Tasa de IVA con la que se generan las facturas del sistema. La mayoría del
    // abarrote es tasa 0%, por eso el default no es 16.
    tasaIvaFactura: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

export type Configuracion = InferSchemaType<typeof ConfiguracionSchema> & { _id: string };

export default models.Configuracion || model("Configuracion", ConfiguracionSchema);
