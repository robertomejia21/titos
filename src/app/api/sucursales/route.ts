import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Sucursal from "@/models/Sucursal";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";
import { normalizarWhatsAppMX } from "@/lib/whatsapp";
import { ZONA_HORARIA_DEFAULT, esZonaHorariaValida } from "@/lib/zonasHorarias";

const PERMISO = "catalogos.administrar";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  const administra = puede(session, PERMISO);
  const consulta = ["reportes.productos", "reportes.ventas", "cortes.ver", "facturas.administrar", "usuarios.administrar", "precios.actualizar", "pedidos.surtir"].some((p) => puede(session, p));
  if (!administra && !consulta) return sinPermiso(PERMISO);

  await connectDB();
  if (!administra) return NextResponse.json(await Sucursal.find({}).select("nombre").sort({ nombre: 1 }).lean());
  const sucursales = await Sucursal.find({}).sort({ nombre: 1 }).lean();

  const usuarios = await UserModel.find({
    role: "sucursal",
    sucursalId: { $in: sucursales.map((s) => s._id) },
  })
    .select("email nombre sucursalId")
    .lean();
  const usuarioPorSucursal = new Map(usuarios.map((u) => [String(u.sucursalId), u]));

  const sucursalesConUsuario = sucursales.map((s) => {
    const usuario = usuarioPorSucursal.get(String(s._id));
    return { ...s, usuario: usuario ? { email: usuario.email, nombre: usuario.nombre } : null };
  });

  return NextResponse.json(sucursalesConUsuario);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  // El permiso se valida explícitamente para que, cuando falte, el error diga
  // cuál es en vez de dejar la pantalla sin explicación.
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  if (!nombre) return badRequest("Ponle nombre a la sucursal");

  if ("zonaHoraria" in body && !esZonaHorariaValida(body.zonaHoraria)) {
    return badRequest("Zona horaria inválida");
  }

  // El usuario de acceso es OPCIONAL: dar de alta la tienda y decidir después
  // quién la va a operar son dos momentos distintos, y exigir los dos juntos
  // dejaba el botón de "Crear sucursal" apagado sin decir por qué. Si se
  // capturan, se piden completos: media credencial no sirve para entrar.
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const creaUsuario = !!email || !!password;

  if (creaUsuario) {
    if (!email) return badRequest("Captura el correo de acceso o deja vacía también la contraseña");
    if (password.length < 6) return badRequest("La contraseña de acceso debe tener al menos 6 caracteres");
  }

  await connectDB();

  if (creaUsuario && (await UserModel.findOne({ email }))) {
    return conflict("Ese correo ya está en uso por otro usuario");
  }

  const sucursal = await Sucursal.create({
    nombre,
    direccion: body.direccion || "",
    whatsapp: body.whatsapp ? normalizarWhatsAppMX(body.whatsapp) : "",
    zonaHoraria: body.zonaHoraria || ZONA_HORARIA_DEFAULT,
  });

  if (!creaUsuario) {
    return NextResponse.json({ sucursal, usuario: null }, { status: 201 });
  }

  const user = await UserModel.create({
    email,
    passwordHash: await hashPassword(password),
    nombre: body.usuarioNombre || nombre,
    role: "sucursal",
    sucursalId: sucursal._id,
  });

  return NextResponse.json(
    { sucursal, usuario: { email: user.email, nombre: user.nombre } },
    { status: 201 }
  );
}
