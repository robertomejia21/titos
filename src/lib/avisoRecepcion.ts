import OrdenCompra from "@/models/OrdenCompra";
import Proveedor from "@/models/Proveedor";
import EvidenciaRecepcion, { bytesEvidencia } from "@/models/EvidenciaRecepcion";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { sendFileByUpload, sendMessage } from "@/lib/greenApi";
import { MOTIVO_RECHAZO_LABEL, type MotivoRechazo } from "@/lib/motivosRechazo";

// Aviso inmediato al confirmar la recepción de una orden de compra: si hubo
// rechazos o llegó menos de lo ordenado, Compras y el proveedor lo saben en ese
// momento, con las fotos de evidencia, y no hasta que alguien arme el reporte.

type ItemOrden = {
  nombreProducto: string;
  cantidadOrdenada: number;
  cantidadRecibida?: number | null;
  cantidadRechazada?: number | null;
  motivoRechazo?: string | null;
  notaRecepcion?: string | null;
};

const fmt = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });

export function diferenciasRecepcion(items: ItemOrden[]) {
  const rechazos = items.filter((i) => (i.cantidadRechazada ?? 0) > 0);
  const faltantes = items.filter((i) => (i.cantidadRecibida ?? 0) + (i.cantidadRechazada ?? 0) < i.cantidadOrdenada);
  return { rechazos, faltantes };
}

export function mensajeRecepcion(orden: { folio: string; items: ItemOrden[] }, proveedor: string, fotos: number) {
  const { rechazos, faltantes } = diferenciasRecepcion(orden.items);
  const lineas = [`*Recepción ${orden.folio} — ${proveedor}*`, ""];
  if (rechazos.length) {
    lineas.push("Devoluciones en el andén:");
    for (const i of rechazos) {
      const llego = (i.cantidadRecibida ?? 0) + (i.cantidadRechazada ?? 0);
      const motivo = MOTIVO_RECHAZO_LABEL[i.motivoRechazo as MotivoRechazo] ?? "Sin motivo";
      lineas.push(`• ${i.nombreProducto}: llegaron ${fmt(llego)}, se reciben ${fmt(i.cantidadRecibida ?? 0)} y se regresan ${fmt(i.cantidadRechazada ?? 0)} — ${motivo}${i.notaRecepcion ? ` (${i.notaRecepcion})` : ""}`);
    }
    lineas.push("");
  }
  if (faltantes.length) {
    lineas.push("Faltantes contra lo ordenado:");
    for (const i of faltantes) {
      const llego = (i.cantidadRecibida ?? 0) + (i.cantidadRechazada ?? 0);
      lineas.push(`• ${i.nombreProducto}: llegaron ${fmt(llego)} de ${fmt(i.cantidadOrdenada)} (faltan ${fmt(i.cantidadOrdenada - llego)})`);
    }
    lineas.push("");
  }
  if (fotos) lineas.push(`Se adjunta${fotos === 1 ? "" : "n"} ${fotos} foto${fotos === 1 ? "" : "s"} de evidencia.`);
  return lineas.join("\n").trim();
}

/** Manda el aviso y deja el resultado en la orden. Nunca lanza: la recepción ya quedó guardada. */
export async function avisarRecepcion(ordenId: unknown, { avisarProveedor }: { avisarProveedor: boolean }) {
  const orden = await OrdenCompra.findById(ordenId);
  if (!orden) return null;
  const { rechazos, faltantes } = diferenciasRecepcion(orden.items);
  if (!rechazos.length && !faltantes.length) {
    orden.avisoRecepcion = { enviadoEn: null, estado: "sin_diferencias", errores: [] };
    await orden.save();
    return orden.avisoRecepcion;
  }

  const [config, proveedor, evidencias] = await Promise.all([
    obtenerConfiguracion(),
    Proveedor.findById(orden.proveedorId).select("nombre whatsapp").lean(),
    EvidenciaRecepcion.find({ ordenCompraId: orden._id }).select("+datos").sort({ createdAt: 1 }).limit(10).lean(),
  ]);
  const destinatarios = [...(config.alertas?.destinatariosCompras ?? [])].filter((d: string) => d.trim());
  if (avisarProveedor && proveedor?.whatsapp) destinatarios.push(proveedor.whatsapp);

  if (!destinatarios.length) {
    orden.avisoRecepcion = { enviadoEn: null, estado: "sin_destinatarios", errores: ["No hay WhatsApp de Compras ni del proveedor"] };
    await orden.save();
    return orden.avisoRecepcion;
  }

  const texto = mensajeRecepcion(orden, proveedor?.nombre ?? "Proveedor", evidencias.length);
  const errores: string[] = [];
  let llegaron = 0;
  for (const numero of [...new Set(destinatarios)]) {
    try {
      await sendMessage(numero, texto);
      for (const [n, foto] of evidencias.entries()) {
        const extension = foto.mime === "image/png" ? "png" : foto.mime === "image/webp" ? "webp" : "jpg";
        await sendFileByUpload(
          numero,
          bytesEvidencia(foto.datos).toString("base64"),
          `${orden.folio}-evidencia-${n + 1}.${extension}`,
          [foto.nombreProducto, foto.nota].filter(Boolean).join(" — "),
          foto.mime
        );
      }
      llegaron++;
    } catch (error) {
      errores.push(`${numero}: ${(error as Error).message}`);
    }
  }
  orden.avisoRecepcion = {
    enviadoEn: new Date(),
    estado: llegaron === 0 ? "fallido" : errores.length ? "parcial" : "enviado",
    errores,
  };
  await orden.save();
  return orden.avisoRecepcion;
}
