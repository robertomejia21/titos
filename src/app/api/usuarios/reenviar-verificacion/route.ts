import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword, generarPasswordUsuario } from "@/lib/auth";
import { enviarBienvenida } from "@/lib/onboarding";
import { getStateInstance, checkWhatsapp, getMessageStatus } from "@/lib/greenApi";

// Vuelve a consultar el estado de mensajes ya enviados (botón "Volver a
// revisar" del modal), sin reenviar ni tocar la contraseña.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "usuarios.administrar")) return sinPermiso("usuarios.administrar");

  const usuarioId = req.nextUrl.searchParams.get("usuarioId") ?? "";
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 5);
  if (!usuarioId || ids.length === 0) return badRequest("Faltan el usuario o los mensajes");

  await connectDB();
  const usuario = await UserModel.findById(usuarioId).select("telefono").lean();
  if (!usuario?.telefono) return badRequest("El usuario no tiene teléfono registrado");

  const estados = await Promise.all(ids.map((id) => getMessageStatus(usuario.telefono!, id).catch(() => null)));
  return NextResponse.json({ ok: true, telefono: usuario.telefono, ids, estados });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "usuarios.administrar")) return sinPermiso("usuarios.administrar");

  const body = await req.json().catch(() => null);
  const usuarioId = String(body?.usuarioId ?? "");
  if (!usuarioId) return badRequest("Falta el ID del usuario");

  await connectDB();

  const usuario = await UserModel.findById(usuarioId).select("nombre usuario telefono apellidoPaterno fechaNacimiento");
  if (!usuario) return badRequest("El usuario no existe");
  if (!usuario.telefono) return badRequest("El usuario no tiene teléfono registrado");
  if (!usuario.usuario || !usuario.apellidoPaterno || !usuario.fechaNacimiento) {
    return badRequest("A este usuario le faltan datos (usuario, apellido paterno o fecha de nacimiento) para generar su contraseña");
  }

  // Antes de tocar la contraseña se confirma que el mensaje puede salir: que
  // sendMessage responda 200 solo significa que Green API lo encoló.
  try {
    const { stateInstance } = await getStateInstance();
    if (stateInstance !== "authorized") {
      return NextResponse.json({ error: `La línea de WhatsApp no está lista para enviar (estado en Green API: ${stateInstance}).` }, { status: 503 });
    }
    const { existsWhatsapp } = await checkWhatsapp(usuario.telefono);
    if (!existsWhatsapp) {
      return NextResponse.json({ error: `El número ${usuario.telefono} no tiene WhatsApp. Corrige el teléfono del usuario.` }, { status: 400 });
    }
  } catch (error) {
    console.error("[reenviar-verificacion] Green API no respondió", error);
    return NextResponse.json({ error: `No se pudo consultar Green API: ${(error as Error).message}` }, { status: 502 });
  }

  // La contraseña es determinista; se regenera y se re-sincroniza el hash para
  // garantizar que lo que se envía es lo que sirve para entrar.
  const passwordPlano = generarPasswordUsuario(usuario.apellidoPaterno, usuario.fechaNacimiento);
  await UserModel.updateOne({ _id: usuario._id }, { passwordHash: await hashPassword(passwordPlano) });

  let ids: string[];
  try {
    ids = await enviarBienvenida({
      telefono: usuario.telefono,
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      password: passwordPlano,
    });
  } catch (error) {
    console.error("[reenviar-verificacion] WhatsApp falló", error);
    return NextResponse.json({ error: `No se pudo enviar el WhatsApp: ${(error as Error).message}` }, { status: 502 });
  }

  // Unos segundos para que Green API lo despache y se pueda leer su estado real.
  await new Promise((r) => setTimeout(r, 4000));
  const estados = await Promise.all(ids.map((id) => getMessageStatus(usuario.telefono!, id).catch(() => null)));
  console.info("[reenviar-verificacion]", usuario.telefono, ids, estados);
  if (estados.some((e) => e === "failed" || e === "noAccount")) {
    return NextResponse.json({ error: `WhatsApp rechazó el mensaje a ${usuario.telefono} (estado: ${estados.join(", ")}).`, ids, estados }, { status: 502 });
  }

  return NextResponse.json({ ok: true, telefono: usuario.telefono, ids, estados });
}
