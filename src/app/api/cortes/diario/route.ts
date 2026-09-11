import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, puede } from "@/lib/apiAuth";
import { tienePermiso } from "@/lib/permisos";
import { corteDiarioHtml, type GrupoCorteDiario, type VentaCorteDiario } from "@/lib/corteDiario";
import { inicioDelDiaEnZona, finDelDiaEnZona, formatFechaHora, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import Sucursal from "@/models/Sucursal";
import Caja from "@/models/CajaSesion";
import Venta from "@/models/Venta";
import Retiro from "@/models/MovimientoCaja";
import Abono from "@/models/AbonoCliente";
import Devolucion from "@/models/Devolucion";
import "@/models/User";

export async function GET(req: NextRequest) {
  const sesion = await requireSession(req);
  if (!sesion) return unauthorized();
  if (!(sesion.role === "matriz" && puede(sesion, "cortes.ver")) && !tienePermiso(sesion, "reportes.globales")) return forbidden();
  const p = new URL(req.url).searchParams;
  const dia = p.get("dia") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !Number.isFinite(Date.parse(dia)) || new Date(dia).toISOString().slice(0,10) !== dia) return badRequest("Elige un día válido para imprimir el corte.");
  const notas = p.get("notas") ?? "con";
  if (!["con", "sin"].includes(notas)) return badRequest("Elige con o sin notas de venta.");
  const id = p.get("sucursalId");
  if (id && !isValidObjectId(id)) return badRequest("Sucursal inválida.");
  await connectDB();
  const sucursales = await Sucursal.find(id ? { _id: id } : {}).select("nombre zonaHoraria").sort({ nombre: 1 }).lean();
  const grupos: GrupoCorteDiario[] = [];
  for (const sucursal of sucursales) {
    const zona = sucursal.zonaHoraria || ZONA_HORARIA_DEFAULT;
    const rango = { $gte: inicioDelDiaEnZona(dia,zona), $lte: finDelDiaEnZona(dia,zona) };
    const base = { sucursalId: sucursal._id };
    const [ventas, cierres, retiros, abonos, devoluciones] = await Promise.all([
      Venta.find({ ...base, corte: dia, estado: "completada", ...(notas === "sin" ? { esVentas2: { $ne: true } } : {}) }).select("folio total descuento esVentas2 pagos").sort({ fecha: 1, _id: 1 }).limit(20001).lean(),
      Caja.find({ ...base, estado: "cerrada", fechaCierre: rango }).populate("usuarioAperturaId", "nombre").sort({ fechaCierre: 1 }).limit(1001).lean(),
      Retiro.find({ ...base, fecha: rango }).select("folio fecha monto moneda motivo").sort({ fecha: 1 }).limit(10001).lean(),
      Abono.find({ ...base, corte: dia }).select("monto metodoPago").limit(10001).lean(),
      Devolucion.find({ ...base, estado: "pagada", cortePago: dia }).populate("ventaId", "esVentas2").select("folio total montoEfectivo montoCredito ventaId").limit(10001).lean(),
    ]);
    if (ventas.length > 20000 || cierres.length > 1000 || retiros.length > 10000 || abonos.length > 10000 || devoluciones.length > 10000) return badRequest("El día supera el límite del reporte; no se imprimen totales incompletos. Contacta a administración.");
    grupos.push({
      nombre: sucursal.nombre, zona, ventas: ventas as unknown as VentaCorteDiario[],
      cierres: cierres.map(c => ({ responsable: (c.usuarioAperturaId as { nombre?: string } | null)?.nombre ?? "No registrado", fecha: formatFechaHora(c.fechaCierre,zona), fondo:c.efectivoInicial ?? 0, fondoUsd:c.efectivoInicialUsd ?? 0, esperado:c.efectivoEsperado ?? 0, contado:c.efectivoContado ?? 0, diferencia:c.diferencia ?? 0, esperadoUsd:c.efectivoEsperadoUsd ?? 0, contadoUsd:c.efectivoContadoUsd ?? 0, diferenciaUsd:c.diferenciaUsd ?? 0 })),
      retiros: retiros.map(r => ({ folio:r.folio, fecha:formatFechaHora(r.fecha,zona), monto:r.monto, moneda:r.moneda ?? "MXN", motivo:r.motivo ?? "" })),
      abonos: abonos as unknown as GrupoCorteDiario["abonos"],
      devoluciones: devoluciones.filter(d => notas === "con" || (d.ventaId && !(d.ventaId as { esVentas2?: boolean }).esVentas2)).map(d => ({ folio:d.folio,total:d.total,montoEfectivo:d.montoEfectivo ?? 0,montoCredito:d.montoCredito ?? 0 })),
    });
  }
  return new NextResponse(corteDiarioHtml(dia, notas === "con", grupos), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
