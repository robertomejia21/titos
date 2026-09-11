import { tienePermiso } from "@/lib/permisos";
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, puede, badRequest } from "@/lib/apiAuth";
import Arqueo from "@/models/Arqueo";
import CajaSesion from "@/models/CajaSesion";
import Sucursal from "@/models/Sucursal";
import User from "@/models/User";
import { inicioDelDiaEnZona, finDelDiaEnZona, fechaEnZona, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import { resumenArqueos, type FilaArqueo } from "@/lib/reporteArqueos";

export async function GET(req: NextRequest) {
  const s = await requireSession(req);
  if (!s) return unauthorized();
  if ((s.role !== "matriz" && !tienePermiso(s, "reportes.globales")) || !puede(s, "cortes.ver")) return forbidden();
  const q = req.nextUrl.searchParams;
  const desde = q.get("desde") || fechaEnZona(new Date());
  const hasta = q.get("hasta") || desde;
  const sucursalId = q.get("sucursalId");
  const valida = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  if (!valida(desde) || !valida(hasta) || desde > hasta) return badRequest("Revisa las fechas del reporte.");
  if (sucursalId && !/^[a-f\d]{24}$/i.test(sucursalId)) return badRequest("Sucursal inválida.");
  await connectDB();
  const sucursales = await Sucursal.find().select("nombre zonaHoraria").lean();
  const sucursalMap = new Map(sucursales.map((s) => [String(s._id), s]));
  if (sucursalId && !sucursalMap.has(sucursalId)) return badRequest("Sucursal no encontrada.");
  const zona = (sucursalId && sucursalMap.get(sucursalId)?.zonaHoraria) || ZONA_HORARIA_DEFAULT;
  const match = { estado: "guardado", guardadoEn: { $gte: inicioDelDiaEnZona(desde, zona), $lte: finDelDiaEnZona(hasta, zona) }, ...(sucursalId ? { sucursalId: new mongoose.Types.ObjectId(sucursalId) } : {}) };
  // Un solo conteo por turno: repetir un arqueo no multiplica su faltante.
  const registros = await Arqueo.aggregate([
    { $match: match }, { $sort: { guardadoEn: -1, _id: -1 } },
    { $group: { _id: "$cajaSesionId", ultimo: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$ultimo" } }, { $sort: { guardadoEn: -1 } },
    { $limit: 1001 }, { $project: { tokenHash: 0, resumen: 0 } },
  ]);
  const limitado = registros.length > 1000;
  const datos = registros.slice(0, 1000);
  const cajas = await CajaSesion.find({ _id: { $in: datos.map((r) => r.cajaSesionId) } }).select("estado usuarioAperturaId fechaCierre diferencia diferenciaUsd").lean();
  const cajaMap = new Map(cajas.map((c) => [String(c._id), c]));
  const usuarios = await User.find({ _id: { $in: [...cajas.map((c) => c.usuarioAperturaId), ...datos.map((r) => r.usuarioId)] } }).select("nombre").lean();
  const usuarioMap = new Map(usuarios.map((u) => [String(u._id), u.nombre]));
  const filas: FilaArqueo[] = datos.map((a) => {
    const caja = cajaMap.get(String(a.cajaSesionId));
    return { id: String(a._id), cajaId: String(a.cajaSesionId), sucursalId: String(a.sucursalId),
      sucursal: sucursalMap.get(String(a.sucursalId))?.nombre ?? "Sucursal no disponible",
      cajero: usuarioMap.get(String(caja?.usuarioAperturaId ?? a.usuarioId)) ?? "Usuario no disponible",
      supervisor: a.supervisorNombre, fecha: a.guardadoEn.toISOString(), esperado: a.efectivoEsperado,
      contado: a.efectivoContado, diferencia: a.diferencia, esperadoUsd: a.efectivoEsperadoUsd,
      contadoUsd: a.efectivoContadoUsd, diferenciaUsd: a.diferenciaUsd, notas: a.notas,
      corte: caja?.estado === "cerrada" ? { fecha: caja.fechaCierre.toISOString(), diferencia: caja.diferencia, diferenciaUsd: caja.diferenciaUsd ?? 0 } : null };
  });
  return NextResponse.json({ filas, resumen: resumenArqueos(filas), limitado, zona, sucursales: sucursales.map((s) => ({ _id: String(s._id), nombre: s.nombre })) }, { headers: { "Cache-Control": "no-store" } });
}
