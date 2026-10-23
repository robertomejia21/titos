import { TIPOS_VEHICULO } from "@/models/Vehiculo";
import { TIPOS_PARADA, TIPOS_RUTA } from "@/models/Ruta";
import { DIAS_SEMANA } from "@/lib/dias";
import { HORA, idONull, texto } from "@/lib/operacionApi";

// Validación del catálogo de unidades y rutas; la comparten el alta y la edición.

export function datosVehiculo(body: Record<string, unknown>) {
  const nombre = texto(body.nombre, 80);
  if (!nombre) throw new Error("Captura el nombre de la unidad");
  if (!TIPOS_VEHICULO.includes(body.tipo as (typeof TIPOS_VEHICULO)[number])) throw new Error("Tipo de unidad inválido");
  return {
    nombre,
    tipo: body.tipo as string,
    refrigerado: body.refrigerado === true,
    placas: texto(body.placas, 20).toUpperCase(),
    notas: texto(body.notas, 300),
    activo: body.activo !== false,
  };
}

export function datosRuta(body: Record<string, unknown>) {
  const nombre = texto(body.nombre, 80);
  if (!nombre) throw new Error("Captura el nombre de la ruta");
  if (!TIPOS_RUTA.includes(body.tipo as (typeof TIPOS_RUTA)[number])) throw new Error("Tipo de ruta inválido");
  if (typeof body.horaSalida !== "string" || !HORA.test(body.horaSalida)) throw new Error("Hora de salida inválida (usa HH:MM)");
  const duracionMin = Number(body.duracionMin ?? 0);
  if (!Number.isInteger(duracionMin) || duracionMin < 0 || duracionMin > 720) throw new Error("La duración debe ir de 0 a 720 minutos");
  const diasSemana = Array.isArray(body.diasSemana) ? body.diasSemana : [...DIAS_SEMANA];
  if (!diasSemana.length || diasSemana.some((d) => !DIAS_SEMANA.includes(d))) throw new Error("Elige los días en que sale la ruta");
  const paradas = Array.isArray(body.paradas) ? body.paradas : [];
  if (paradas.length > 30) throw new Error("Una ruta admite hasta 30 paradas");
  const paradasLimpias = paradas.map((p: Record<string, unknown>) => {
    if (!TIPOS_PARADA.includes(p?.tipo as (typeof TIPOS_PARADA)[number])) throw new Error("Tipo de parada inválido");
    const sucursalId = idONull(p.sucursalId);
    if (p.tipo === "sucursal" && !sucursalId) throw new Error("Elige la tienda de cada parada de entrega");
    const descripcion = texto(p.descripcion, 120);
    if (p.tipo !== "sucursal" && !descripcion) throw new Error("Describe las paradas que no son tienda (qué se recoge y dónde)");
    return { tipo: p.tipo, sucursalId: p.tipo === "sucursal" ? sucursalId : null, descripcion };
  });
  const responsable = idONull(body.choferResponsableId);
  const sustituto = idONull(body.choferSustitutoId);
  if (responsable && responsable === sustituto) throw new Error("El sustituto debe ser otro chofer");
  return {
    nombre,
    tipo: body.tipo as string,
    horaSalida: body.horaSalida,
    duracionMin,
    diasSemana,
    paradas: paradasLimpias,
    requiereRefrigerado: body.requiereRefrigerado === true,
    vehiculoPreferidoId: idONull(body.vehiculoPreferidoId),
    choferResponsableId: responsable,
    choferSustitutoId: sustituto,
    notas: texto(body.notas, 500),
    orden: Number.isFinite(Number(body.orden)) ? Number(body.orden) : 0,
    activo: body.activo !== false,
  };
}
