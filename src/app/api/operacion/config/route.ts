import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { badRequest } from "@/lib/apiAuth";
import { obtenerConfiguracionOperacion } from "@/lib/operacion";
import { sesionOperacion, HORA } from "@/lib/operacionApi";
import { CRITERIOS_PRORRATEO } from "@/models/ConfiguracionOperacion";
import Sucursal from "@/models/Sucursal";
import { tienePermiso } from "@/lib/permisos";

function respuesta(config: Awaited<ReturnType<typeof obtenerConfiguracionOperacion>>, puedeVerToken: boolean) {
  const objeto = config.toObject();
  // La llave de la pantalla abre el rol sin sesión: solo la ve quien edita la configuración.
  if (!puedeVerToken) delete objeto.pantallaToken;
  return objeto;
}

export async function GET(req: NextRequest) {
  const { session, error } = await sesionOperacion(req, "configuracion.editar", "pedidos.surtir", "inventario.administrar");
  if (error) return error;
  const [config, sucursales] = await Promise.all([
    obtenerConfiguracionOperacion(),
    Sucursal.find({ activo: true, esMatriz: { $ne: true } }).select("nombre").sort({ nombre: 1 }).lean(),
  ]);
  return NextResponse.json({ ...respuesta(config, tienePermiso(session, "configuracion.editar") || tienePermiso(session, "pedidos.surtir")), sucursales });
}

export async function PATCH(req: NextRequest) {
  const { error } = await sesionOperacion(req, "configuracion.editar");
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");
  const config = await obtenerConfiguracionOperacion();

  if ("criterioProrrateo" in body) {
    if (!CRITERIOS_PRORRATEO.includes(body.criterioProrrateo)) return badRequest("Criterio de prorrateo inválido");
    config.criterioProrrateo = body.criterioProrrateo;
  }
  if ("prioridadSucursales" in body) {
    if (!Array.isArray(body.prioridadSucursales)) return badRequest("La prioridad de tiendas debe ser una lista");
    const ids = body.prioridadSucursales.map((p: { sucursalId?: unknown }) => String(p?.sucursalId ?? ""));
    if (ids.some((id: string) => !mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) return badRequest("Hay tiendas inválidas o repetidas en la prioridad");
    // Se guarda en el orden recibido: la posición es la prioridad.
    config.prioridadSucursales = ids.map((sucursalId: string, i: number) => ({ sucursalId, prioridad: i + 1 }));
  }
  if ("segundaVuelta" in body) {
    const dias = Number(body.segundaVuelta?.diasVigencia ?? 3);
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) return badRequest("La vigencia de faltantes debe ser de 1 a 30 días");
    config.segundaVuelta = { automatica: body.segundaVuelta?.automatica !== false, diasVigencia: dias };
  }
  if ("temporadaAlta" in body) {
    const meses = Array.isArray(body.temporadaAlta?.meses) ? body.temporadaAlta.meses.map(Number) : [];
    if (meses.some((m: number) => !Number.isInteger(m) || m < 1 || m > 12)) return badRequest("Los meses de temporada alta van del 1 al 12");
    const factor = Number(body.temporadaAlta?.factorMinimos ?? 1);
    if (!Number.isFinite(factor) || factor < 1 || factor > 5) return badRequest("El factor de temporada debe ir de 1 a 5");
    config.temporadaAlta = { meses: [...new Set<number>(meses)].sort((a, b) => a - b), factorMinimos: factor };
  }
  if ("faltantesDiarios" in body) {
    const f = body.faltantesDiarios ?? {};
    if (f.hora !== undefined && !HORA.test(f.hora)) return badRequest("Hora de envío inválida (usa HH:MM)");
    config.faltantesDiarios = {
      activo: f.activo !== false,
      hora: f.hora ?? config.faltantesDiarios?.hora ?? "13:00",
      destinatariosAlmacen: Array.isArray(f.destinatariosAlmacen) ? f.destinatariosAlmacen.map((d: unknown) => String(d).trim()).filter(Boolean) : [],
      enviarAProveedores: f.enviarAProveedores === true,
    };
  }
  if ("duracionRutaMin" in body) {
    const minutos = Number(body.duracionRutaMin);
    if (!Number.isInteger(minutos) || minutos < 30 || minutos > 720) return badRequest("La duración de una ruta debe ir de 30 a 720 minutos");
    config.duracionRutaMin = minutos;
  }

  await config.save();
  return NextResponse.json(respuesta(config, true));
}
