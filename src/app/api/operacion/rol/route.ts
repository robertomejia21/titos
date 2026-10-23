import { NextRequest, NextResponse } from "next/server";
import { badRequest } from "@/lib/apiAuth";
import { hoyCedis } from "@/lib/operacion";
import { HORA, idONull, sesionOperacion, texto } from "@/lib/operacionApi";
import { cargarRol, guardarRolDelDia, type SalidaEditada } from "@/lib/rolDelDia";
import { TIPOS_PARADA, TIPOS_RUTA } from "@/models/Ruta";
import { ESTADOS_SALIDA } from "@/models/RolEntrega";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const fecha = req.nextUrl.searchParams.get("fecha") || (await hoyCedis());
  if (!FECHA.test(fecha)) return badRequest("Fecha inválida");
  return NextResponse.json(await cargarRol(fecha));
}

function validarSalida(s: Record<string, unknown>): SalidaEditada {
  const nombre = texto(s.nombre, 80);
  if (!nombre) throw new Error("Cada salida necesita nombre");
  if (!TIPOS_RUTA.includes(s.tipo as (typeof TIPOS_RUTA)[number])) throw new Error(`Tipo inválido en "${nombre}"`);
  if (typeof s.horaSalida !== "string" || !HORA.test(s.horaSalida)) throw new Error(`Hora inválida en "${nombre}"`);
  if (!ESTADOS_SALIDA.includes(s.estado as (typeof ESTADOS_SALIDA)[number])) throw new Error(`Estado inválido en "${nombre}"`);
  const duracionMin = Number(s.duracionMin ?? 0);
  if (!Number.isFinite(duracionMin) || duracionMin < 0 || duracionMin > 720) throw new Error(`Duración inválida en "${nombre}"`);
  const paradas = (Array.isArray(s.paradas) ? s.paradas : []).map((p: Record<string, unknown>) => {
    if (!TIPOS_PARADA.includes(p?.tipo as (typeof TIPOS_PARADA)[number])) throw new Error(`Parada inválida en "${nombre}"`);
    const descripcion = texto(p.descripcion, 120);
    const sucursalId = idONull(p.sucursalId);
    if (p.tipo === "sucursal" && !sucursalId) throw new Error(`Elige la tienda de cada parada en "${nombre}"`);
    if (p.tipo !== "sucursal" && !descripcion) throw new Error(`Describe la parada extra en "${nombre}"`);
    return { tipo: p.tipo as string, sucursalId: p.tipo === "sucursal" ? sucursalId : null, descripcion };
  });
  const pedidoIds = (Array.isArray(s.pedidoIds) ? s.pedidoIds : []).map(idONull);
  if (pedidoIds.some((p) => !p)) throw new Error(`Hay folios inválidos en "${nombre}"`);
  return {
    ...(idONull(s._id) ? { _id: s._id as string } : {}),
    rutaId: idONull(s.rutaId),
    nombre,
    tipo: s.tipo as string,
    horaSalida: s.horaSalida,
    duracionMin,
    requiereRefrigerado: s.requiereRefrigerado === true,
    vehiculoId: idONull(s.vehiculoId),
    choferId: idONull(s.choferId),
    paradas,
    pedidoIds: pedidoIds as string[],
    estado: s.estado as string,
    motivoSugerencia: texto(s.motivoSugerencia, 300),
    ajustadaManualmente: s.ajustadaManualmente === true,
    notas: texto(s.notas, 300),
  };
}

/** Guarda el rol ajustado a mano. */
export async function PUT(req: NextRequest) {
  const { session, error } = await sesionOperacion(req, "pedidos.surtir");
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.fecha !== "string" || !FECHA.test(body.fecha)) return badRequest("Fecha inválida");
  if (!Array.isArray(body.salidas) || body.salidas.length > 40) return badRequest("Salidas inválidas");
  let salidas: SalidaEditada[];
  try {
    salidas = body.salidas.map(validarSalida);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  const todos = salidas.flatMap((s) => s.pedidoIds);
  if (new Set(todos).size !== todos.length) return badRequest("Un folio no puede ir en dos salidas");
  return NextResponse.json(await guardarRolDelDia(body.fecha, salidas, session));
}
