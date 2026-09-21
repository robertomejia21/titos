import { validarPermisosIndividuales, PermisosIndividualesError } from "@/lib/permisosIndividuales";
import { NextRequest, NextResponse } from "next/server";
import { requiereNipCaja } from "@/lib/nipCaja";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import RolModel from "@/models/Rol";
import Departamento from "@/models/Departamento";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, badRequest, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";
import { asegurarRolesSemilla } from "@/lib/roles";
import { verificarNipCreacionSupervisor } from "@/lib/configuracion";
import { NIP_OPERACION_REGEX } from "@/lib/supervisores";
import { prepararNipPersonal, NipPersonalError, esNipDuplicado } from "@/lib/nipPersonal";
import { validarTelefono, normalizarWhatsApp } from "@/lib/whatsapp";
import { generarTokenVerificacion, enviarVerificacionWhatsApp } from "@/lib/verificacionWhatsApp";

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
      .select("nombre email role sucursalRol sucursalId rolId activo nipOperacionHash permisosIndividuales permisosSoloConsulta telefono codigoArea telefonoVerificado")
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
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const role = String(body?.role ?? "");
  const sucursalId = body?.sucursalId ? String(body.sucursalId) : null;
  const rolId = body?.rolId ? String(body.rolId) : null;
  const nipSupervisor = String(body?.nipCreacionSupervisor ?? "").trim();
  const nipOperacion = String(body?.nipOperacion ?? "").trim();
  const telefono = String(body?.telefono ?? "").trim();
  const codigoArea = String(body?.codigoArea ?? "").trim();

  if (!nombre) return badRequest("El nombre es requerido");
  if (!rolId) return badRequest("Elige el puesto del usuario");
  if (!email) return badRequest("El correo es requerido");
  if (password.length < 6) return badRequest("La contraseña debe tener al menos 6 caracteres");
  if (!["matriz", "sucursal"].includes(role)) return badRequest("Elige si el usuario es de matriz o de sucursal");
  if (role === "sucursal" && !sucursalId) return badRequest("Elige la sucursal del usuario");
  if (!telefono) return badRequest("El teléfono es obligatorio");
  if (!["+52", "+1"].includes(codigoArea)) return badRequest("Selecciona el código de área: +52 (México) o +1 (EUA)");
  if (!validarTelefono(telefono, codigoArea as "+52" | "+1")) return badRequest("El número de teléfono no es válido");

  await connectDB();

  if (await UserModel.findOne({ email })) return conflict("Ese correo ya está en uso por otro usuario");

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
    const tokenVerificacion = generarTokenVerificacion();
    const usuario = await UserModel.create({
      nombre,
      email,
      passwordHash: await hashPassword(password),
      role,
      sucursalId: role === "sucursal" ? sucursalId : null,
      rolId,
      telefono: telefonoNormalizado,
      codigoArea,
      telefonoVerificado: false,
      tokenVerificacion,
      tokenVerificacionExpira: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...nipPersonal,
      ...permisosUsuario,
      activo: false,
    });

    try {
      await enviarVerificacionWhatsApp(telefonoNormalizado, nombre, tokenVerificacion);
    } catch {
      // Si Green API falla, el usuario queda creado pero sin verificar.
      // El admin puede reenviar desde la pantalla de usuarios.
    }

    return NextResponse.json({ _id: String(usuario._id), verificacionEnviada: true }, { status: 201 });
  } catch (error) {
    if (error instanceof PermisosIndividualesError) return badRequest(error.message);
    if (error instanceof NipPersonalError) return badRequest(error.message);
    if (esNipDuplicado(error)) return conflict("Ese NIP ya está asignado a otra persona");
    throw error;
  }
}
