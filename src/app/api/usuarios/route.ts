import { validarPermisosIndividuales, PermisosIndividualesError } from "@/lib/permisosIndividuales";
import { NextRequest, NextResponse } from "next/server";
import { requiereNipCaja } from "@/lib/nipCaja";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import RolModel from "@/models/Rol";
import Departamento from "@/models/Departamento";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, badRequest, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword, generarPasswordUsuario } from "@/lib/auth";
import { enviarBienvenida } from "@/lib/onboarding";
import { asegurarRolesSemilla } from "@/lib/roles";
import { verificarNipCreacionSupervisor } from "@/lib/configuracion";
import { NIP_OPERACION_REGEX } from "@/lib/supervisores";
import { prepararNipPersonal, NipPersonalError, esNipDuplicado } from "@/lib/nipPersonal";
import { validarTelefono, normalizarWhatsApp } from "@/lib/whatsapp";

// Administración unificada de usuarios: matriz da de alta y edita los usuarios
// de todas las sucursales desde un solo lugar. Antes cada sucursal administraba
// los suyos por separado y los de matriz solo existían por script de seed.

const PERMISO = "usuarios.administrar";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  await connectDB();
  await asegurarRolesSemilla();

  const [usuarios, roles, sucursales, departamentos] = await Promise.all([
    UserModel.find({})
      .select("nombre usuario apellidoPaterno fechaNacimiento email role sucursalRol sucursalId rolId activo nipOperacionHash permisosIndividuales permisosSoloConsulta telefono codigoArea telefonoVerificado estadoVerificacion")
      .populate("rolId", "nombre ambito codigoSistema perfilDocumentoId departamentoId")
      .populate("sucursalId", "nombre")
      .sort({ role: 1, nombre: 1 })
      .lean(),
    RolModel.find({ retirado: { $ne: true } }).sort({ ambito: 1, nombre: 1 }).lean(),
    Sucursal.find({}).select("nombre esMatriz").sort({ nombre: 1 }).lean(),
    Departamento.find({}).sort({ nombre: 1 }).lean(),
  ]);

  return NextResponse.json({
    usuarios: usuarios.map((u) => ({
      _id: String(u._id),
      nombre: u.nombre,
      usuario: u.usuario ?? null,
      apellidoPaterno: u.apellidoPaterno ?? null,
      fechaNacimiento: u.fechaNacimiento ? new Date(u.fechaNacimiento).toISOString().slice(0, 10) : null,
      email: u.email,
      role: u.role,
      sucursalRol: u.sucursalRol ?? "admin",
      sucursal: u.sucursalId && typeof u.sucursalId === "object" ? u.sucursalId : null,
      rol: u.rolId && typeof u.rolId === "object" ? u.rolId : null,
      // El hash nunca sale; solo si ya tiene NIP, para que la pantalla sepa si
      // ofrece "asignar" o "cambiar".
      tieneNipOperacion: requiereNipCaja(u.rolId) && !!u.nipOperacionHash,
      permisosIndividuales: u.permisosIndividuales ?? null,
      permisosSoloConsulta: u.permisosSoloConsulta ?? [],
      telefono: u.telefono ?? null,
      codigoArea: u.codigoArea ?? null,
      telefonoVerificado: u.telefonoVerificado ?? false,
      estadoVerificacion: u.estadoVerificacion ?? (u.telefonoVerificado ? "verificado" : "pendiente"),
      activo: u.activo,
      // El propio usuario no puede desactivarse ni cambiarse el rol a sí mismo.
      propio: String(u._id) === session.userId,
    })),
    roles: roles.map((r) => ({
      _id: String(r._id),
      nombre: r.nombre,
      descripcion: r.descripcion,
      codigoSistema: r.codigoSistema ?? null,
      departamentoId: r.departamentoId ? String(r.departamentoId) : null,
      ambito: r.ambito,
      permisos: r.permisos ?? [],
      perfilDocumentoId: r.perfilDocumentoId ?? null,
      // La pantalla lo usa para pedir el NIP de 6 dígitos en cuanto se elige un
      // rol de supervisor, en vez de esperar a que el servidor rechace el alta.
      esSupervisor: !!r.esSupervisor,
      esSistema: r.esSistema,
      activo: r.activo,
    })),
    departamentos: departamentos.map((d) => ({ _id: String(d._id), nombre: d.nombre, descripcion: d.descripcion, activo: d.activo })),
    sucursales: sucursales.map((s) => ({ _id: String(s._id), nombre: s.nombre, esMatriz: !!s.esMatriz })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const usuario = String(body?.usuario ?? "").trim();
  const apellidoPaterno = String(body?.apellidoPaterno ?? "").trim();
  const fechaNacimiento = String(body?.fechaNacimiento ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const role = String(body?.role ?? "");
  const sucursalId = body?.sucursalId ? String(body.sucursalId) : null;
  const rolId = body?.rolId ? String(body.rolId) : null;
  const nipSupervisor = String(body?.nipCreacionSupervisor ?? "").trim();
  const nipOperacion = String(body?.nipOperacion ?? "").trim();
  const telefono = String(body?.telefono ?? "").trim();
  const codigoArea = String(body?.codigoArea ?? "").trim();

  if (!nombre) return badRequest("El nombre es requerido");
  if (!usuario) return badRequest("El usuario es requerido");
  if (!apellidoPaterno) return badRequest("El apellido paterno es requerido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) return badRequest("La fecha de nacimiento es requerida");
  if (!rolId) return badRequest("Elige el puesto del usuario");
  if (!["matriz", "sucursal"].includes(role)) return badRequest("Elige si el usuario es de matriz o de sucursal");
  if (role === "sucursal" && !sucursalId) return badRequest("Elige la sucursal del usuario");
  if (!telefono) return badRequest("El teléfono es obligatorio");
  if (!["+52", "+1"].includes(codigoArea)) return badRequest("Selecciona el código de área: +52 (México) o +1 (EUA)");
  if (!validarTelefono(telefono, codigoArea as "+52" | "+1")) return badRequest("El número de teléfono no es válido");

  await connectDB();

  if (await UserModel.findOne({ usuario })) return conflict("Ese usuario ya está en uso por otro colaborador");
  if (email && (await UserModel.findOne({ email }))) return conflict("Ese correo ya está en uso por otro usuario");

  if (sucursalId && !(await Sucursal.findById(sucursalId).select("_id").lean())) {
    return badRequest("La sucursal no existe");
  }

  // Un rol de sucursal no puede asignarse a un usuario de matriz ni al revés:
  // sus permisos no aplican del otro lado.
  if (rolId) {
    const rol = await RolModel.findById(rolId).select("nombre codigoSistema perfilDocumentoId ambito activo retirado esSupervisor").lean();
    if (!rol) return badRequest("El rol no existe");
    if (rol.retirado) return badRequest("Este rol fue sustituido. Elige un puesto del catálogo actual.");
    if (!rol.activo) return badRequest("Ese rol está desactivado");
    if (rol.ambito !== role) return badRequest("El rol elegido no corresponde al tipo de usuario");
    if (requiereNipCaja(rol)) {
      if (!NIP_OPERACION_REGEX.test(nipOperacion)) return badRequest("Asigna un NIP personal de 6 dígitos al gerente de tienda");
    } else if (nipOperacion) return badRequest("El NIP personal es solo para el gerente de tienda");

    // El supervisor es quien autoriza cancelaciones y retiros: crear uno exige
    // el NIP de 6 dígitos que matriz guarda en /matriz/configuracion, para que
    // no baste con tener acceso a esta pantalla.
    if (requiereNipCaja(rol)) {
      const autorizacion = await verificarNipCreacionSupervisor(nipSupervisor);
      if (!autorizacion.ok) return badRequest(autorizacion.error);

      // Un encargado de turno sin NIP no puede autorizar nada, así que crearlo
      // sin él sería crear un encargado que no ejerce.
      if (!NIP_OPERACION_REGEX.test(nipOperacion)) {
        return badRequest("Asígnale al encargado de turno un NIP de 6 dígitos para autorizar cancelaciones y retiros");
      }
    }
  }

  const telefonoNormalizado = normalizarWhatsApp(telefono, codigoArea as "+52" | "+1");

  try {
    const permisosUsuario = "permisosIndividuales" in body ? validarPermisosIndividuales(body, role as "matriz" | "sucursal") : {};
    const nipPersonal = nipOperacion ? await prepararNipPersonal(nipOperacion) : {};
    // La contraseña se autogenera (apellido paterno + día/mes de nacimiento) y se
    // envía al colaborador por WhatsApp junto con su usuario.
    const passwordPlano = generarPasswordUsuario(apellidoPaterno, fechaNacimiento);
    const nuevo = await UserModel.create({
      nombre,
      usuario,
      apellidoPaterno,
      fechaNacimiento: new Date(fechaNacimiento),
      email: email || null,
      passwordHash: await hashPassword(passwordPlano),
      role,
      sucursalId: role === "sucursal" ? sucursalId : null,
      rolId,
      telefono: telefonoNormalizado,
      codigoArea,
      telefonoVerificado: false,
      estadoVerificacion: "verificado",
      ...nipPersonal,
      ...permisosUsuario,
      activo: true,
    });

    // El saludo + credenciales no deben tumbar el alta si WhatsApp falla: el
    // usuario ya quedó creado y las credenciales se pueden reenviar.
    let whatsappEnviado = true;
    try {
      await enviarBienvenida({ telefono: telefonoNormalizado, nombre, usuario, password: passwordPlano });
    } catch {
      whatsappEnviado = false;
    }

    return NextResponse.json({ _id: String(nuevo._id), whatsappEnviado }, { status: 201 });
  } catch (error) {
    if (error instanceof PermisosIndividualesError) return badRequest(error.message);
    if (error instanceof NipPersonalError) return badRequest(error.message);
    if (esNipDuplicado(error)) return conflict("Ese NIP ya está asignado a otra persona");
    throw error;
  }
}
