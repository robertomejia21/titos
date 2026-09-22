import { validarPermisosIndividuales } from "@/lib/permisosIndividuales";
import { NextRequest, NextResponse } from "next/server";
import { requiereNipCaja } from "@/lib/nipCaja";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import RolModel from "@/models/Rol";
import Sucursal from "@/models/Sucursal";
import {
  requireSession,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  conflict,
  puede,
  sinPermiso,
} from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";
import { verificarNipCreacionSupervisor } from "@/lib/configuracion";
import { prepararNipPersonal, NipPersonalError, esNipDuplicado } from "@/lib/nipPersonal";
import { validarTelefono, normalizarWhatsApp } from "@/lib/whatsapp";

const PERMISO = "usuarios.administrar";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  await connectDB();
  const usuario = await UserModel.findById(id);
  if (!usuario) return notFound("Usuario no encontrado");

  // Quien edita no puede quitarse a sí mismo el acceso: sería la forma más
  // fácil de dejar el sistema sin nadie que pueda administrarlo.
  const esPropio = String(usuario._id) === session.userId;
  if (esPropio && ("activo" in body || "rolId" in body || "role" in body || "permisosIndividuales" in body || "permisosSoloConsulta" in body)) {
    return badRequest("Otro administrador debe cambiar tus permisos, puesto o estado");
  }

  if ("nombre" in body) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return badRequest("El nombre es requerido");
    usuario.nombre = nombre;
  }

  if ("email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email && (await UserModel.findOne({ email, _id: { $ne: usuario._id } }))) {
      return conflict("Ese correo ya está en uso por otro usuario");
    }
    usuario.email = email || null;
  }

  if ("usuario" in body) {
    const nuevoUsuario = String(body.usuario ?? "").trim();
    if (!nuevoUsuario) return badRequest("El usuario es requerido");
    if (await UserModel.findOne({ usuario: nuevoUsuario, _id: { $ne: usuario._id } })) {
      return conflict("Ese usuario ya está en uso por otro colaborador");
    }
    usuario.usuario = nuevoUsuario;
  }

  if ("apellidoPaterno" in body) {
    const ap = String(body.apellidoPaterno ?? "").trim();
    if (!ap) return badRequest("El apellido paterno es requerido");
    usuario.apellidoPaterno = ap;
  }

  if ("fechaNacimiento" in body) {
    const fn = String(body.fechaNacimiento ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fn)) return badRequest("La fecha de nacimiento es requerida (AAAA-MM-DD)");
    usuario.fechaNacimiento = new Date(fn);
  }

  if ("password" in body && body.password) {
    const password = String(body.password);
    if (password.length < 6) return badRequest("La contraseña debe tener al menos 6 caracteres");
    usuario.passwordHash = await hashPassword(password);
  }

  if ("sucursalId" in body) {
    const sucursalId = body.sucursalId ? String(body.sucursalId) : null;
    if (usuario.role === "sucursal" && !sucursalId) return badRequest("Un usuario de sucursal necesita una sucursal");
    if (sucursalId && !(await Sucursal.findById(sucursalId).select("_id").lean())) {
      return badRequest("La sucursal no existe");
    }
    usuario.sucursalId = sucursalId;
  }

  if ("rolId" in body) {
    const rolId = body.rolId ? String(body.rolId) : null;
    if (rolId) {
      const rol = await RolModel.findById(rolId).select("ambito activo retirado esSupervisor codigoSistema perfilDocumentoId").lean();
      if (!rol) return badRequest("El rol no existe");
      if (rol.retirado) return badRequest("Este rol fue sustituido. Elige un puesto del catálogo actual.");
    if (!rol.activo) return badRequest("Ese rol está desactivado");
      if (rol.ambito !== usuario.role) return badRequest("El rol elegido no corresponde al tipo de usuario");

      // Ascender a alguien a supervisor pide el mismo NIP que crearlo: si no,
      // el candado se saltaría dando de alta un cajero y editándolo enseguida.
      // Solo se pide cuando el rol cambia: guardar el nombre de un supervisor
      // que ya lo era no tiene por qué exigirlo.
      if (requiereNipCaja(rol) && String(usuario.rolId ?? "") !== rolId) {
        const autorizacion = await verificarNipCreacionSupervisor(
          String(body.nipCreacionSupervisor ?? "").trim()
        );
        if (!autorizacion.ok) return badRequest(autorizacion.error);
      }
      if (requiereNipCaja(rol) && !usuario.nipOperacionHash && !body.nipOperacion) {
        return badRequest("Asigna un NIP personal al supervisor");
      }
    }
    usuario.rolId = rolId;
  }

  const rolFinal = usuario.rolId ? await RolModel.findById(usuario.rolId).select("nombre codigoSistema perfilDocumentoId esSupervisor").lean() : null;
  const usaNip = requiereNipCaja(rolFinal, usuario);
  const nuevoNip = String(body.nipOperacion ?? "").trim();
  if (!usaNip && nuevoNip) return badRequest("El NIP personal es solo para el gerente de tienda");
  if (usaNip && !usuario.nipOperacionHash && !nuevoNip) return badRequest("Asigna un NIP personal al gerente de tienda");
  if (!usaNip) { usuario.nipOperacionHash = ""; usuario.nipOperacionHuella = undefined; }
  if (usaNip && nuevoNip) {
    try {
      Object.assign(usuario, await prepararNipPersonal(nuevoNip, id));
    } catch (error) {
      if (error instanceof NipPersonalError) return badRequest(error.message);
      throw error;
    }
  }

  if ("permisosIndividuales" in body || "permisosSoloConsulta" in body) {
    try {
      Object.assign(usuario, validarPermisosIndividuales({ permisosIndividuales: usuario.permisosIndividuales ?? null, permisosSoloConsulta: usuario.permisosSoloConsulta ?? [], ...body }, usuario.role));
    } catch (error) { return badRequest((error as Error).message); }
  }

  if ("telefono" in body || "codigoArea" in body) {
    const codigoArea = String(body.codigoArea ?? usuario.codigoArea ?? "+52").trim();
    const telefono = String(body.telefono ?? usuario.telefono ?? "").trim();
    if (!["+52", "+1"].includes(codigoArea)) return badRequest("Código de área inválido");
    if (!telefono) return badRequest("El teléfono es obligatorio");
    if (!validarTelefono(telefono, codigoArea as "+52" | "+1")) return badRequest("El número de teléfono no es válido");
    const normalizado = normalizarWhatsApp(telefono, codigoArea as "+52" | "+1");
    if (normalizado !== usuario.telefono) {
      usuario.telefono = normalizado;
      usuario.telefonoVerificado = false;
    }
    usuario.codigoArea = codigoArea;
  }

  if ("activo" in body) usuario.activo = Boolean(body.activo);

  try {
    await usuario.save();
  } catch (error) {
    if (esNipDuplicado(error)) return conflict("Ese NIP ya está asignado a otra persona");
    throw error;
  }

  return NextResponse.json({ ok: true });
}
