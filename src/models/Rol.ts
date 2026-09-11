import { Schema, model, models, type InferSchemaType } from "mongoose";
import { AMBITOS_ROL } from "@/lib/rolesConstantes";

// Perfil de permisos que se le asigna a un usuario. Antes solo existían dos
// perfiles fijos en código ("admin" y "ventas"); ahora matriz puede definir los
// que necesite desde /matriz/usuarios.

const RolSchema = new Schema(
  {
    nombre: { type: String, required: true, unique: true, trim: true },
    descripcion: { type: String, default: "", trim: true },
    // Un rol de sucursal no puede traer permisos de matriz ni al revés: el
    // ámbito es lo que decide qué casillas se ofrecen al editarlo.
    ambito: { type: String, enum: AMBITOS_ROL, required: true },
    permisos: { type: [String], default: [] },
    perfilDocumentoId: { type: String },
    codigoSistema: { type: String },
    retirado: { type: Boolean, default: false },
    // Marca los roles de mando (supervisor de piso, encargado de turno). Dar de
    // alta o ascender a alguien a uno de estos roles exige el NIP de creación
    // de supervisores que matriz configura en /matriz/configuracion: el rol es
    // lo que decide quién autoriza cancelaciones, así que repartirlo sin
    // candado equivale a repartir la caja.
    esSupervisor: { type: Boolean, default: false },
    // Los roles semilla no se pueden borrar: son los que reproducen los perfiles
    // con los que ya venía operando el sistema.
    esSistema: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RolSchema.index({ codigoSistema: 1 }, { unique: true, partialFilterExpression: { codigoSistema: { $type: "string" } } });
RolSchema.index({ ambito: 1, activo: 1 });
RolSchema.index({ perfilDocumentoId: 1 }, { unique: true, partialFilterExpression: { perfilDocumentoId: { $type: "string" } } });

export type Rol = InferSchemaType<typeof RolSchema> & { _id: string };

export default models.Rol || model("Rol", RolSchema);
