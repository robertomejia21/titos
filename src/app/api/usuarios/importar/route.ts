import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";
import RolModel from "@/models/Rol";
import Sucursal from "@/models/Sucursal";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword, generarPasswordUsuario } from "@/lib/auth";
import { enviarBienvenida } from "@/lib/onboarding";
import { validarTelefono, normalizarWhatsApp } from "@/lib/whatsapp";

const PERMISO = "usuarios.administrar";

type FilaImport = {
  nombre: string;
  apellidoPaterno: string;
  fechaNacimiento: string;
  usuario: string;
  puesto: string;
  telefono: string;
  codigoArea: "+52" | "+1";
  sucursal: string;
  email?: string;
};

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, PERMISO)) return sinPermiso(PERMISO);

  const body = await req.json().catch(() => null);
  const filas: FilaImport[] = body?.filas;
  if (!Array.isArray(filas) || filas.length === 0) return badRequest("No se recibieron filas para importar");
  if (filas.length > 200) return badRequest("Máximo 200 usuarios por importación");

  await connectDB();

  const [roles, sucursales] = await Promise.all([
    RolModel.find({ activo: true, retirado: { $ne: true } }).lean(),
    Sucursal.find({}).lean(),
  ]);

  const normNombre = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/@/g, "").toLowerCase().trim();

  const rolPorNombre = new Map(roles.map((r) => [normNombre(r.nombre), r]));
  // Aliases for common Excel shorthand → DB role names
  const ALIASES_ROL: Record<string, string[]> = {
    "gerente de tienda": ["gerente"],
    "cajero": ["cajero", "cajera", "cajer"],
    "almacenista": ["almacenista"],
    "compras": ["compras"],
    "inventario": ["inventarios", "inventario"],
    "contabilidad": ["contabilidad", "contador", "contadora"],
    "administrador general": ["admin", "administrador"],
  };
  for (const [rolName, aliases] of Object.entries(ALIASES_ROL)) {
    const rol = rolPorNombre.get(normNombre(rolName));
    if (!rol) continue;
    for (const alias of aliases) rolPorNombre.set(normNombre(alias), rol);
  }

  const sucursalPorNombre = new Map(sucursales.map((s) => [normNombre(s.nombre), s]));

  const existentes = new Set(
    (await UserModel.find({}).select("usuario email telefono").lean())
      .flatMap((u) => [u.usuario, u.email?.toLowerCase(), u.telefono].filter(Boolean))
  );

  const resultados: { fila: number; nombre: string; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const nombre = String(f.nombre ?? "").trim();
    const apellidoPaterno = String(f.apellidoPaterno ?? "").trim();
    const fechaNacimiento = String(f.fechaNacimiento ?? "").trim();
    const usuario = String(f.usuario ?? "").trim();
    const puestoRaw = String(f.puesto ?? "").trim();
    const telefonoRaw = String(f.telefono ?? "").replace(/\D/g, "");
    const codigoArea = (["+52", "+1"] as const).includes(f.codigoArea as "+52" | "+1") ? f.codigoArea : "+52";
    const sucursalRaw = String(f.sucursal ?? "").trim();
    const emailRaw = String(f.email ?? "").trim().toLowerCase();

    if (!nombre) { resultados.push({ fila: i + 1, nombre: nombre || "(vacío)", ok: false, error: "Nombre vacío" }); continue; }
    if (!usuario) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Usuario vacío" }); continue; }
    if (!apellidoPaterno) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Apellido paterno vacío" }); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Fecha de nacimiento inválida (usa AAAA-MM-DD)" }); continue; }
    if (existentes.has(usuario)) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Usuario ya registrado" }); continue; }
    if (!telefonoRaw) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Teléfono vacío" }); continue; }
    if (!validarTelefono(telefonoRaw, codigoArea as "+52" | "+1")) { resultados.push({ fila: i + 1, nombre, ok: false, error: `Teléfono inválido: ${telefonoRaw}` }); continue; }

    const telefonoNorm = normalizarWhatsApp(telefonoRaw, codigoArea as "+52" | "+1");
    if (existentes.has(telefonoNorm)) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Teléfono ya registrado" }); continue; }

    if (emailRaw && existentes.has(emailRaw)) { resultados.push({ fila: i + 1, nombre, ok: false, error: "Correo ya registrado" }); continue; }

    const rol = rolPorNombre.get(normNombre(puestoRaw));
    if (!rol) { resultados.push({ fila: i + 1, nombre, ok: false, error: `Puesto no encontrado: "${puestoRaw}"` }); continue; }

    const sucursal = sucursalPorNombre.get(normNombre(sucursalRaw));
    if (!sucursal) { resultados.push({ fila: i + 1, nombre, ok: false, error: `Sucursal no encontrada: "${sucursalRaw}"` }); continue; }

    const role = rol.ambito as "matriz" | "sucursal";

    try {
      const passwordPlano = generarPasswordUsuario(apellidoPaterno, fechaNacimiento);
      await UserModel.create({
        nombre,
        usuario,
        apellidoPaterno,
        fechaNacimiento: new Date(fechaNacimiento),
        email: emailRaw || null,
        passwordHash: await hashPassword(passwordPlano),
        role,
        sucursalId: role === "sucursal" ? sucursal._id : null,
        rolId: rol._id,
        telefono: telefonoNorm,
        codigoArea,
        telefonoVerificado: false,
        estadoVerificacion: "verificado",
        activo: true,
      });
      existentes.add(usuario);
      if (emailRaw) existentes.add(emailRaw);
      existentes.add(telefonoNorm);
      // Envío del saludo + credenciales; un fallo de WhatsApp no revierte el alta.
      let aviso: string | undefined;
      try {
        await enviarBienvenida({ telefono: telefonoNorm, nombre, usuario, password: passwordPlano });
      } catch {
        aviso = "creado, pero no se pudo enviar WhatsApp";
      }
      resultados.push({ fila: i + 1, nombre, ok: true, error: aviso });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Error desconocido";
      resultados.push({ fila: i + 1, nombre, ok: false, error: msg.includes("duplicate") ? "Registro duplicado" : msg });
    }
  }

  const creados = resultados.filter((r) => r.ok).length;
  const errores = resultados.filter((r) => !r.ok).length;

  return NextResponse.json({ creados, errores, resultados });
}
