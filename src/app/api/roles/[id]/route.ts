import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import RolModel from "@/models/Rol";
import UserModel from "@/models/User";
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
import { esPermisoValido } from "@/lib/permisos";
import { verificarNipCreacionSupervisor } from "@/lib/configuracion";

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
  const rol = await RolModel.findById(id);
  if (!rol) return notFound("Rol no encontrado");

  if ("nombre" in body) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return badRequest("El nombre del rol no puede quedar vacío");
    rol.nombre = nombre;
  }
  if ("descripcion" in body) rol.descripcion = String(body.descripcion ?? "").trim();

  if ("permisos" in body) {
    rol.permisos = Array.isArray(body.permisos)
      ? body.permisos.map((p: unknown) => String(p)).filter(esPermisoValido)
      : [];
  }

  // Convertir un rol existente en rol de supervisor pide el NIP por la misma
  // razón que crearlo así: es el marcado, no el nombre, lo que abre el candado.
  if ("esSupervisor" in body) {
    const esSupervisor = body.esSupervisor === true;
    if (esSupervisor && !rol.esSupervisor) {
      const autorizacion = await verificarNipCreacionSupervisor(
        String(body.nipCreacionSupervisor ?? "").trim()
      );
      if (!autorizacion.ok) return badRequest(autorizacion.error);
    }
    rol.esSupervisor = esSupervisor;
  }

  // El ámbito no se puede cambiar: los usuarios ya asignados quedarían con
  // permisos del lado equivocado del sistema.
  if ("activo" in body) {
    if (rol.esSistema && !body.activo) return badRequest("Los roles del sistema no se pueden desactivar");
    rol.activo = Boolean(body.activo);
  }

  try {
    await rol.save();
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return conflict("Ya existe un rol con ese nombre");
    }
    throw err;
  }

  return NextResponse.json({ ...rol.toObject(), _id: String(rol._id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const { id } = await params;

  await connectDB();
  const rol = await RolModel.findById(id);
  if (!rol) return notFound("Rol no encontrado");
  if (rol.esSistema) return conflict("Los roles del sistema no se pueden eliminar");

  const enUso = await UserModel.exists({ rolId: rol._id });
  if (enUso) return conflict("Hay usuarios con este rol asignado; cámbialos de rol antes de eliminarlo");

  await RolModel.findByIdAndDelete(id);
  return NextResponse.json({ ok: true });
}
