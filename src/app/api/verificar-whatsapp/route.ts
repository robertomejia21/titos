import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import UserModel from "@/models/User";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token.length !== 64) {
    return NextResponse.json({ ok: false, error: "Token inválido" }, { status: 400 });
  }

  await connectDB();

  const usuario = await UserModel.findOne({
    tokenVerificacion: token,
    tokenVerificacionExpira: { $gt: new Date() },
  }).select("_id nombre telefonoVerificado");

  if (!usuario) {
    return NextResponse.json({ ok: false, error: "El enlace ya expiró o no es válido" }, { status: 404 });
  }

  if (usuario.telefonoVerificado) {
    return NextResponse.json({ ok: true, mensaje: "Esta cuenta ya fue verificada" });
  }

  await UserModel.updateOne(
    { _id: usuario._id },
    {
      telefonoVerificado: true,
      activo: true,
      tokenVerificacion: null,
      tokenVerificacionExpira: null,
    }
  );

  return NextResponse.json({ ok: true, mensaje: "Cuenta verificada correctamente", nombre: usuario.nombre });
}
