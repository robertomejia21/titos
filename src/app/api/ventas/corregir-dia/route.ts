import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, badRequest, puede, todayCorte } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import { obtenerConfiguracion } from "@/lib/configuracion";
import Venta from "@/models/Venta";
import Factura from "@/models/Factura";
import { candidatosFolioVenta } from "@/lib/folios";

export async function POST(req:NextRequest) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (usuario.role!=="matriz" || !puede(usuario,"configuracion.editar")) return forbidden();
  const body = await req.json().catch(()=>null);
  if (!body || typeof body.folio!=="string" || typeof body.motivo!=="string" || body.motivo.trim().length<10 || body.motivo.length>1000) return badRequest("Captura folio y un motivo de 10 a 1,000 caracteres.");
  const dia = body.dia;
  if (typeof dia!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || !Number.isFinite(Date.parse(dia)) || new Date(dia).toISOString().slice(0,10)!==dia || dia>todayCorte()) return badRequest("Elige un día válido, no futuro.");
  await connectDB();
  if (!(await obtenerConfiguracion()).reglasOperacion?.permitirCorreccionDia) return badRequest("Activa primero la corrección de día en Configuración.");
  const ventas = await Venta.find({folio:{$in:candidatosFolioVenta(body.folio)},estado:"completada"}).limit(2);
  if (ventas.length!==1) return badRequest("Usa el folio completo de una venta vigente y única.");
  const venta = ventas[0];
  if (venta.facturaGlobalId) return badRequest("La venta está incluida en una global. Cancela primero la global interna antes de cambiar su día.");
  if (await Factura.exists({ventaId:venta._id,estado:{$ne:"cancelada"}})) return badRequest("La venta tiene una factura vigente. Requiere ajuste fiscal; no se puede cambiar su día aquí.");
  if (venta.corte===dia) return badRequest("La venta ya está en ese día.");
  const actualizada = await Venta.findOneAndUpdate({_id:venta._id,corte:venta.corte,estado:"completada",facturaGlobalId:null},{$set:{corte:dia},$push:{correccionesDia:{anterior:venta.corte,nuevo:dia,motivo:body.motivo.trim(),usuarioId:usuario.userId,fecha:new Date()}}},{returnDocument:"after"});
  if (!actualizada) return NextResponse.json({error:"La venta cambió mientras la revisabas. Vuelve a consultar."},{status:409});
  return NextResponse.json({folio:actualizada.folio,diaAnterior:venta.corte,diaNuevo:dia,fechaOriginal:actualizada.fecha,historial:actualizada.correccionesDia,mensaje:"Día del reporte corregido. La fecha original, los pagos y el corte de caja conservan sus registros."});
}
