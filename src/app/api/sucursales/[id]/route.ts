import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Sucursal from "@/models/Sucursal";
import UserModel from "@/models/User";
import InventarioSucursal from "@/models/InventarioSucursal";
import Pedido from "@/models/Pedido";
import Venta from "@/models/Venta";
import CajaSesion from "@/models/CajaSesion";
import { requireSession, unauthorized, forbidden, notFound, badRequest, conflict, puede, sinPermiso } from "@/lib/apiAuth";
import { normalizarWhatsAppMX } from "@/lib/whatsapp";
import { verifyPassword } from "@/lib/auth";
import { esZonaHorariaValida } from "@/lib/zonasHorarias";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  const { id } = await params;
  if (session.role === "sucursal" && session.sucursalId !== id) return forbidden();
  if (session.role !== "matriz" && session.role !== "sucursal") return forbidden();
  // Matriz administra el catálogo de tiendas; una sucursal solo edita sus
  // propios datos de contacto y para eso le basta con poder abrir sus ajustes.
  const permiso = session.role === "matriz" ? "catalogos.administrar" : "sucursal.ajustes";
  if (!puede(session, permiso)) return sinPermiso(permiso);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  await connectDB();

  const updatableComun = ["direccion", "whatsapp"];
  // La zona horaria define las horas de la sucursal (corte de pedidos, cortes de caja), solo matriz la ajusta.
  const updatableMatriz = ["nombre", "activo", "zonaHoraria"];
  const permitidos = session.role === "matriz" ? [...updatableComun, ...updatableMatriz] : updatableComun;

  const update: Record<string, unknown> = {};
  for (const key of permitidos) {
    if (key in body) update[key] = body[key];
  }
  if (update.whatsapp) update.whatsapp = normalizarWhatsAppMX(update.whatsapp as string);
  if ("zonaHoraria" in update && !esZonaHorariaValida(update.zonaHoraria)) return badRequest("Zona horaria inválida");

  const sucursal = await Sucursal.findByIdAndUpdate(id, update, { new: true });
  if (!sucursal) return notFound("Sucursal no encontrada");

  return NextResponse.json(sucursal);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();
  if (!puede(session, "catalogos.administrar")) return sinPermiso("catalogos.administrar");

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const password = body?.password;
  if (!password) return badRequest("Debes confirmar tu contraseña para eliminar la sucursal");

  await connectDB();

  const usuario = await UserModel.findById(session.userId);
  if (!usuario) return unauthorized();

  const passwordValida = await verifyPassword(password, usuario.passwordHash);
  if (!passwordValida) return badRequest("Contraseña incorrecta");

  const sucursal = await Sucursal.findById(id);
  if (!sucursal) return notFound("Sucursal no encontrada");
  if (sucursal.esMatriz) {
    return conflict("El mostrador de matriz no se puede eliminar. Desactívalo si dejas de vender en matriz.");
  }

  const [tienePedidos, tieneVentas, tieneCortes] = await Promise.all([
    Pedido.exists({ sucursalId: id }),
    Venta.exists({ sucursalId: id }),
    CajaSesion.exists({ sucursalId: id }),
  ]);

  if (tienePedidos || tieneVentas || tieneCortes) {
    return conflict(
      "No se puede eliminar: esta sucursal ya tiene pedidos, ventas o cortes de caja registrados. Desactívala en su lugar."
    );
  }

  await Promise.all([
    Sucursal.findByIdAndDelete(id),
    UserModel.deleteMany({ sucursalId: id, role: "sucursal" }),
    InventarioSucursal.deleteMany({ sucursalId: id }),
  ]);

  return NextResponse.json({ ok: true });
}
