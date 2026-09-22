import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, puede } from "@/lib/apiAuth";
import { sucursalConsultada } from "@/lib/puntoVenta";
import { validarEquipoCaja } from "@/lib/equiposCaja";
import EquipoCaja from "@/models/EquipoCaja";
import Sucursal from "@/models/Sucursal";
import TerminalPago from "@/models/TerminalPago";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  await connectDB();
  const admin = session.role === "matriz" && puede(session, "configuracion.editar");
  const id = await sucursalConsultada(session, admin ? req.nextUrl : new URL(req.nextUrl.origin));
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return badRequest("Sucursal inválida");
  const [sucursales, equipo, terminales] = await Promise.all([
    Sucursal.find(admin ? {} : { _id: id }).select("nombre").sort({ nombre: 1 }).lean(),
    EquipoCaja.findOne({ sucursalId: id }).lean(),
    TerminalPago.find({ sucursalId: id, activo: true }).select("alias banco marca").lean(),
  ]);
  return NextResponse.json({ sucursalId: id, sucursales, equipo, terminales, puedeEditar: admin && !session.permisosSoloConsulta?.includes("configuracion.editar") });
}

export async function PUT(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "configuracion.editar") || session.permisosSoloConsulta?.includes("configuracion.editar")) return forbidden();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.sucursalId !== "string" || !/^[a-f0-9]{24}$/i.test(body.sucursalId)) return badRequest("Elige una sucursal válida");
  let configuracion;
  try { configuracion = validarEquipoCaja(body.configuracion); } catch (e) { return badRequest((e as Error).message); }
  await connectDB();
  if (!await Sucursal.exists({ _id: body.sucursalId })) return badRequest("La sucursal no existe");
  if (configuracion.terminalId && !await TerminalPago.exists({ _id: configuracion.terminalId, sucursalId: body.sucursalId, activo: true })) return badRequest("La terminal debe estar activa y pertenecer a esta sucursal");
  const equipo = await EquipoCaja.findOneAndUpdate({ sucursalId: body.sucursalId }, { $set: { configuracion, actualizadoPor: session.nombre } }, { upsert: true, returnDocument: "after" });
  return NextResponse.json(equipo);
}
