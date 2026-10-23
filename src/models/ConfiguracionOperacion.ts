import { Schema, model, models, type InferSchemaType } from "mongoose";

// Reglas de la operación del CEDIS: cómo se reparte la mercancía cuando no
// alcanza, en qué orden se atienden las tiendas, cuándo entra la temporada alta
// y a quién se le manda la lista de faltantes. Es un documento único, aparte de
// Configuracion, porque lo ajusta el coordinador de almacén y no quien
// administra cajas, NIP y facturación.

export const CRITERIOS_PRORRATEO = ["caja_completa", "proporcional", "prioridad"] as const;
export type CriterioProrrateo = (typeof CRITERIOS_PRORRATEO)[number];

const PrioridadSucursalSchema = new Schema(
  {
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", required: true },
    /** 1 = se atiende primero. */
    prioridad: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const ConfiguracionOperacionSchema = new Schema(
  {
    /**
     * Cómo se reparte un producto que no alcanza para todas las tiendas:
     * - caja_completa: proporcional, pero en cajas cerradas (se evita reempacar);
     *   las piezas sueltas se reparten por prioridad.
     * - proporcional: cada tienda recibe la misma fracción de lo que pidió.
     * - prioridad: se llena tienda por tienda en el orden de prioridad.
     */
    criterioProrrateo: { type: String, enum: CRITERIOS_PRORRATEO, default: "caja_completa" },
    prioridadSucursales: { type: [PrioridadSucursalSchema], default: [] },

    segundaVuelta: {
      type: new Schema(
        {
          /** Al recibir una orden de compra se arma solo el complemento de los pedidos que quedaron cortos. */
          automatica: { type: Boolean, default: true },
          /** Hasta cuántos días atrás se completan pedidos; lo más viejo ya no se persigue. */
          diasVigencia: { type: Number, default: 3, min: 1, max: 30 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    temporadaAlta: {
      type: new Schema(
        {
          /** Meses (1-12) en los que aplican los mínimos de temporada alta. */
          meses: { type: [Number], default: [12] },
          /**
           * Multiplicador para los productos que no tienen un mínimo de temporada
           * propio. 1 = no cambia nada.
           */
          factorMinimos: { type: Number, default: 1.5, min: 1, max: 5 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    faltantesDiarios: {
      type: new Schema(
        {
          activo: { type: Boolean, default: true },
          /** Hora local (HH:MM) a la que el cron manda la lista del día. */
          hora: { type: String, default: "13:00" },
          /** WhatsApp del almacén; Compras usa la lista de Configuración → Alertas. */
          destinatariosAlmacen: { type: [String], default: [] },
          /**
           * Además de la copia interna, a cada proveedor le llega su parte. Se
           * prende a mano: antes hay que revisar que el WhatsApp capturado de
           * cada proveedor sea el de la persona responsable.
           */
          enviarAProveedores: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    /** Minutos que se da por ocupada una camioneta y su chofer al salir a ruta. */
    duracionRutaMin: { type: Number, default: 150, min: 30, max: 720 },

    /** Llave de la pantalla del área operativa (la TV no inicia sesión). */
    pantallaToken: { type: String, default: "" },
  },
  { timestamps: true }
);

export type ConfiguracionOperacion = InferSchemaType<typeof ConfiguracionOperacionSchema> & { _id: string };

export default models.ConfiguracionOperacion || model("ConfiguracionOperacion", ConfiguracionOperacionSchema);
