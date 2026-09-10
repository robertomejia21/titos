import { NextRequest, NextResponse } from "next/server";
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
  if (esPropio && ("activo" in body || "rolId" in body || "role" in body)) {
    return badRequest("No puedes cambiar tu propio rol ni desactivar tu usuario");
  }

  if ("nombre" in body) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return badRequest("El nombre es requerido");
    usuario.nombre = nombre;
  }

  if ("email" in body) {
    const email = String(body.email).trim().toLowerCase();
    if (!email) return badRequest("El correo es requerido");
    if (await UserModel.findOne({ email, _id: { $ne: usuario._id } })) {
      return conflict("Ese correo ya está en uso por otro usuario");
    }
    usuario.email = email;
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
      const rol = await RolModel.findById(rolId).select("ambito activo esSupervisor").lean();
      if (!rol) return badRequest("El rol no existe");
      if (!rol.activo) return badRequest("Ese rol está desactivado");
      if (rol.ambito !== usuario.role) return badRequest("El rol elegido no corresponde al tipo de usuario");

      // Ascender a alguien a supervisor pide el mismo NIP que crearlo: si no,
      // el candado se saltaría dando de alta un cajero y editándolo enseguida.
      // Solo se pide cuando el rol cambia: guardar el nombre de un supervisor
      // que ya lo era no tiene por qué exigirlo.
      if (rol.esSupervisor && String(usuario.rolId ?? "") !== rolId) {
        const autorizacion = await verificarNipCreacionSupervisor(
          String(body.nipCreacionSupervisor ?? "").trim()
        );
        if (!autorizacion.ok) return badRequest(autorizacion.error);
      }
      if (rol.esSupervisor && !usuario.nipOperacionHash && !body.nipOperacion) {
        return badRequest("Asigna un NIP personal al supervisor");
      }
    }
    usuario.rolId = rolId;
  }

  // Omitir el campo conserva el NIP actual. Un NIP no se comparte entre roles.
  if ("nipOperacion" in body) {
    try {
      Object.assign(usuario, await prepararNipPersonal(String(body.nipOperacion ?? "").trim(), id));
    } catch (error) {
      if (error instanceof NipPersonalError) return badRequest(error.message);
      throw error;
    }
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
