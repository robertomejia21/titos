import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    // Identificador con el que inicia sesión. Se asigna al dar de alta al
    // usuario y sustituye al correo como "gate" del login.
    usuario: { type: String, unique: true, sparse: true, trim: true },
    // El correo pasó a ser solo un dato de contacto opcional.
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, default: null },
    passwordHash: { type: String, required: true },
    nombre: { type: String, required: true },
    // Datos con los que se autogenera la contraseña (apellidoPaterno.DDMM).
    apellidoPaterno: { type: String, trim: true, default: null },
    fechaNacimiento: { type: Date, default: null },
    role: { type: String, enum: ["matriz", "sucursal"], required: true },
    // Rol interno dentro de la sucursal: admin (todo) o ventas (solo punto de venta).
    // Se conserva para los usuarios que todavía no tienen un `rolId` asignado:
    // de él se deducen sus permisos (ver permisosLegado en lib/permisos).
    sucursalRol: { type: String, enum: ["admin", "ventas"], default: "admin" },
    // Perfil de permisos configurable. Cuando está presente manda sobre
    // `sucursalRol`; cuando no, se usa el comportamiento anterior.
    rolId: { type: Schema.Types.ObjectId, ref: "Rol", default: null },
    // null hereda el puesto; [] es una decisión explícita de no dar accesos.
    permisosIndividuales: { type: [String], default: null },
    permisosSoloConsulta: { type: [String], default: [] },
    sucursalId: { type: Schema.Types.ObjectId, ref: "Sucursal", default: null },
    // NIP de 6 dígitos del encargado de turno, con el que autoriza cancelaciones
    // y retiros en el punto de venta. Se guarda hasheado y nunca sale por la
    // API: solo se informa si el usuario ya tiene uno. Es lo que permite que la
    // bitácora diga QUIÉN autorizó, y no solo que alguien lo hizo.
    telefono: { type: String, trim: true, default: null },
    codigoArea: { type: String, enum: ["+52", "+1"], default: null },
    telefonoVerificado: { type: Boolean, default: false },
    // "pendiente" = esperando "alta", "esperando_password" = ya mandó alta, falta contraseña
    estadoVerificacion: { type: String, enum: ["pendiente", "esperando_password", "verificado"], default: "pendiente" },
    tokenVerificacion: { type: String, default: null, select: false },
    tokenVerificacionExpira: { type: Date, default: null, select: false },
    nipOperacionHash: { type: String, default: "" },
    nipOperacionHuella: { type: String, select: false },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type User = InferSchemaType<typeof UserSchema> & { _id: string };

export default models.User || model("User", UserSchema);
