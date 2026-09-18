import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import Venta from "@/models/Venta";
import Factura from "@/models/Factura";
import FacturaGlobal from "@/models/FacturaGlobal";
import Devolucion from "@/models/Devolucion";
import Sucursal from "@/models/Sucursal";
import { fechaEnZona, sumarDias, ZONA_HORARIA_DEFAULT } from "./zonasHorarias";
import type { ResumenGlobal, VentaGlobal } from "./facturaGlobalTipos";

export class ErrorFacturaGlobal extends Error {}
export const sumaImportes = (valores: number[]) =>
  valores.reduce((s, n) => s + Math.round(n * 100), 0) / 100;
export function diaGlobalValido(dia: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(dia) &&
    Number.isFinite(Date.parse(dia)) &&
    new Date(dia).toISOString().slice(0, 10) === dia
  );
}

export async function resumenFacturaGlobal(
  sucursalId: string,
  diaSolicitado?: string,
  session: ClientSession | null = null,
): Promise<ResumenGlobal> {
  const sucursales = await Sucursal.find(sucursalId ? { _id: sucursalId } : {})
    .session(session)
    .lean();
  if (sucursalId && !sucursales.length)
    throw new ErrorFacturaGlobal("Sucursal no encontrada.");
  const sucursalNombre = sucursalId
    ? sucursales[0].nombre
    : "Todas las sucursales";
  const zona = sucursalId
    ? sucursales[0].zonaHoraria || ZONA_HORARIA_DEFAULT
    : ZONA_HORARIA_DEFAULT;
  const scope = sucursalId ? { sucursalId } : {};
  const nombres = new Map(sucursales.map((s) => [String(s._id), s.nombre]));
  const hoy = fechaEnZona(new Date(), zona);
  const dia = diaSolicitado || sumarDias(hoy, -1);
  if (!diaGlobalValido(dia) || dia > hoy)
    throw new ErrorFacturaGlobal("Elige una fecha válida, no futura.");
  const ventas = await Venta.find({
    ...scope,
    corte: dia,
    estado: "completada",
  })
    .select("folio fecha total esVentas2 pagos sucursalId")
    .sort({ fecha: 1, _id: 1 })
    .limit(20001)
    .session(session)
    .lean();
  if (ventas.length > 20000)
    throw new ErrorFacturaGlobal(
      "El día supera 20,000 ventas. No se generan totales incompletos; contacta a administración.",
    );
  const ids = ventas.map((v) => v._id);
  // Consultas secuenciales: MongoDB no permite operaciones paralelas en una transacción.
  const individuales = await Factura.find({
    ventaId: { $in: ids },
    estado: "generada",
  })
    .select("folio ventaId ventaFolio total timbrado.estado")
    .session(session)
    .lean();
  const globales = await FacturaGlobal.find({
    dia,
    ...(sucursalId ? { "ventas.sucursalId": sucursalId } : {}),
  })
    .sort({ createdAt: -1 })
    .session(session)
    .lean();
  const vinculadas = await FacturaGlobal.find({
    "ventas.ventaId": { $in: ids },
    estado: "generada",
  })
    .select("dia ventas.ventaId")
    .session(session)
    .lean();
  const devoluciones = await Devolucion.find({
    ...scope,
    estado: "pagada",
    cortePago: dia,
  })
    .select("total")
    .limit(20001)
    .session(session)
    .lean();
  if (devoluciones.length > 20000)
    throw new ErrorFacturaGlobal(
      "Demasiadas devoluciones para presentar un total completo.",
    );
  const facturadas = new Set(individuales.map((f) => String(f.ventaId)));
  const enGlobal = new Set<string>(
    vinculadas.flatMap((f) =>
      f.ventas.map((v: { ventaId: unknown }) => String(v.ventaId)),
    ),
  );
  const filas: VentaGlobal[] = ventas.map((v) => ({
    ventaId: String(v._id),
    sucursalId: String(v.sucursalId),
    sucursalNombre: nombres.get(String(v.sucursalId)) || "Sucursal",
    folio: v.folio,
    fecha: new Date(v.fecha).toISOString(),
    total: v.total,
    esVentas2: !!v.esVentas2,
    credito: sumaImportes(
      v.pagos
        .filter((p: { metodoPago: string }) => p.metodoPago === "credito")
        .map((p: { monto: number }) => p.monto),
    ),
  }));
  const pendientes = filas.filter(
    (v) => !facturadas.has(v.ventaId) && !enGlobal.has(v.ventaId),
  );
  const totalVentas = sumaImportes(filas.map((v) => v.total));
  const totalIndividuales = sumaImportes(individuales.map((f) => f.total));
  const totalGlobales = sumaImportes(
    globales
      .filter((f) => f.estado === "generada")
      .flatMap((f) =>
        f.ventas
          .filter(
            (v: { sucursalId: unknown }) =>
              !sucursalId || String(v.sucursalId) === sucursalId,
          )
          .map((v: { total: number }) => v.total),
      ),
  );
  const totalPendiente = sumaImportes(pendientes.map((v) => v.total));
  const devolucionesDia = sumaImportes(devoluciones.map((d) => d.total));
  const diferencia = sumaImportes([
    totalVentas,
    -totalIndividuales,
    -totalGlobales,
    -totalPendiente,
  ]);
  const avisos: string[] = [];
  if (vinculadas.some((g) => g.dia !== dia))
    avisos.push(
      "Hay ventas incluidas en una global de otro día. Revisa las correcciones de fecha antes de generar.",
    );
  if (
    facturadas.size !== individuales.length ||
    filas.some((v) => facturadas.has(v.ventaId) && enGlobal.has(v.ventaId))
  )
    avisos.push(
      "Hay ventas con más de un documento vigente. Revisa las facturas antes de generar.",
    );
  if (diferencia !== 0)
    avisos.push(
      "Los documentos vigentes no coinciden con las ventas registradas. Revisa cancelaciones o cambios de fecha.",
    );
  return {
    dia,
    hoy,
    sucursalId,
    sucursalNombre,
    zonaHoraria: zona,
    huella: createHash("sha256")
      .update(
        JSON.stringify({
          dia,
          sucursalId,
          pendientes,
          individuales,
          globales: globales.map((g) => [g._id, g.estado, g.total]),
        }),
      )
      .digest("hex"),
    ventas: ventas.length,
    totalVentas,
    totalIndividuales,
    totalGlobales,
    totalPendiente,
    diferencia,
    credito: sumaImportes(filas.map((v) => v.credito)),
    devolucionesDia,
    netoTrasDevoluciones: sumaImportes([totalVentas, -devolucionesDia]),
    pendientes,
    individuales: individuales.map((f) => ({
      folio: f.folio,
      ventaFolio: f.ventaFolio,
      total: f.total,
      timbrada: f.timbrado?.estado === "timbrada",
    })),
    globales: JSON.parse(
      JSON.stringify(
        globales.map((g) => ({
          ...g,
          totalConsulta: sumaImportes(
            g.ventas
              .filter(
                (v: { sucursalId: unknown }) =>
                  !sucursalId || String(v.sucursalId) === sucursalId,
              )
              .map((v: { total: number }) => v.total),
          ),
        })),
      ),
    ),
    avisos,
  };
}
