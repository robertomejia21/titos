// Orquesta el timbrado de una factura: junta los datos que el CFDI necesita
// (emisor, productos, sucursal), lo arma, lo manda al PAC y guarda la
// respuesta. Es la única ruta por la que una factura se timbra.
//
// Lo que aquí se guarda ya no se puede deshacer borrando: un CFDI timbrado
// solo se cancela. Por eso todo lo que puede fallar se valida ANTES de llamar
// al PAC, y el resultado se escribe apenas llega, aunque el guardado falle
// después: perder el UUID de un timbre ya emitido deja una factura fantasma
// ante el SAT que nadie puede conciliar.

import mongoose from "mongoose";
import Factura from "@/models/Factura";
import Producto from "@/models/Producto";
import Sucursal from "@/models/Sucursal";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { construirCfdi, ErrorCfdi, type FacturaLike, type FiscalPorProducto } from "@/lib/cfdi";
import { emisorDesde } from "@/lib/emisorFiscal";
import type { FiscalProducto } from "@/lib/fiscalProducto";
import { ErrorSw, cancelar, timbrar, type RespuestaTimbrado } from "@/lib/sw";
import type { MotivoCancelacion } from "@/lib/facturas";

/** Error con mensaje presentable para quien opera facturación. */
export class ErrorTimbrado extends Error {
  readonly problemas: string[];
  constructor(mensaje: string, problemas: string[] = []) {
    super(mensaje);
    this.name = "ErrorTimbrado";
    this.problemas = problemas.length ? problemas : [mensaje];
  }
}

type DocFactura = InstanceType<typeof Factura>;

/** Datos fiscales de los productos que aparecen en la factura. */
async function fiscalDeConceptos(factura: DocFactura): Promise<FiscalPorProducto> {
  const ids = factura.conceptos
    .map((c: { productoId?: unknown }) => c.productoId)
    .filter(Boolean);
  if (!ids.length) return new Map();

  const productos = await Producto.find({ _id: { $in: ids } })
    .select("_id fiscal")
    .lean<{ _id: mongoose.Types.ObjectId; fiscal?: FiscalProducto }[]>();

  const mapa: FiscalPorProducto = new Map();
  for (const p of productos) if (p.fiscal) mapa.set(String(p._id), p.fiscal);
  return mapa;
}

/** CP desde el que se expide. El de la tienda manda sobre el de la empresa. */
async function lugarExpedicion(factura: DocFactura): Promise<string> {
  if (!factura.sucursalId) return "";
  const sucursal = await Sucursal.findById(factura.sucursalId)
    .select("codigoPostal")
    .lean<{ codigoPostal?: string } | null>();
  return sucursal?.codigoPostal || "";
}

/**
 * Arma el CFDI de una factura sin mandarlo a ningún lado.
 * Sirve para que la UI pueda avisar qué falta antes de gastar un timbre.
 */
export async function previsualizarCfdi(factura: DocFactura) {
  const config = await obtenerConfiguracion();
  const emisor = emisorDesde(config.emisorFiscal);
  const fiscales = await fiscalDeConceptos(factura);
  return construirCfdi(factura as unknown as FacturaLike, emisor, fiscales, {
    lugarExpedicion: await lugarExpedicion(factura),
  });
}

/**
 * Timbra una factura ante el SAT a través del PAC y guarda el resultado.
 *
 * @throws ErrorTimbrado si la factura no es timbrable o si el PAC la rechaza.
 */
export async function timbrarFactura(factura: DocFactura): Promise<DocFactura> {
  if (factura.estado === "cancelada")
    throw new ErrorTimbrado("Esta factura está cancelada: no se puede timbrar.");
  if (factura.timbrado?.estado === "timbrada")
    throw new ErrorTimbrado(
      `Esta factura ya está timbrada (UUID ${factura.timbrado.uuid}). Para reemplazarla hay que cancelarla ante el SAT y emitir otra.`,
    );

  let cfdi;
  try {
    cfdi = await previsualizarCfdi(factura);
  } catch (error) {
    if (error instanceof ErrorCfdi)
      throw new ErrorTimbrado("La factura todavía no se puede timbrar.", error.problemas);
    throw error;
  }

  let respuesta: RespuestaTimbrado;
  try {
    respuesta = await timbrar(cfdi, {
      pdf: true, // para que el PAC devuelva el QR de verificación
      // El folio como customId: si este request se reintenta (timeout de red,
      // doble clic), el PAC reconoce el duplicado en vez de cobrar otro timbre
      // y emitir un segundo CFDI de la misma venta.
      customId: `${factura.serie || "A"}-${factura.folio}`,
      email: factura.receptor?.emailFacturacion ? [factura.receptor.emailFacturacion] : undefined,
    });
  } catch (error) {
    // El rechazo se guarda en la factura para que quede rastro de por qué no
    // se timbró, sin tumbar la petición si el guardado falla.
    if (error instanceof ErrorSw) {
      factura.timbrado.estado = "error";
      factura.timbrado.error = [error.codigo, error.message, error.detalle]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 2000);
      await factura.save().catch(() => {});
      throw new ErrorTimbrado(`El PAC rechazó la factura: ${error.message}`, [
        error.detalle || error.message,
      ]);
    }
    throw error;
  }

  factura.timbrado.estado = "timbrada";
  factura.timbrado.uuid = respuesta.uuid ?? "";
  factura.timbrado.fechaTimbrado = respuesta.fechaTimbrado ? new Date(respuesta.fechaTimbrado) : new Date();
  factura.timbrado.proveedor = "SW sapien";
  factura.timbrado.error = "";
  factura.timbrado.xml = respuesta.cfdi ?? "";
  factura.timbrado.selloCFDI = respuesta.selloCFDI ?? "";
  factura.timbrado.selloSAT = respuesta.selloSAT ?? "";
  factura.timbrado.noCertificadoSAT = respuesta.noCertificadoSAT ?? "";
  factura.timbrado.cadenaOriginalSAT = respuesta.cadenaOriginalSAT ?? "";
  factura.timbrado.qrCode = respuesta.qrCode ?? "";
  await factura.save();
  return factura;
}

/**
 * Cancela ante el SAT una factura ya timbrada y la marca cancelada.
 * Si la factura no está timbrada esto no aplica: se cancela solo en el sistema.
 */
export async function cancelarFacturaEnSat(
  factura: DocFactura,
  motivoSat: MotivoCancelacion,
  folioSustitucion: string,
  usuarioId: string,
  motivo: string,
): Promise<DocFactura> {
  if (factura.estado === "cancelada")
    throw new ErrorTimbrado("Esta factura ya está cancelada.");
  if (factura.timbrado?.estado !== "timbrada")
    throw new ErrorTimbrado("Esta factura no está timbrada: no hay nada que cancelar ante el SAT.");

  const config = await obtenerConfiguracion();
  const rfcEmisor = emisorDesde(config.emisorFiscal).rfc;
  if (!rfcEmisor)
    throw new ErrorTimbrado("Falta el RFC de la empresa en Configuración para cancelar.");

  let acuse: unknown;
  try {
    acuse = await cancelar(rfcEmisor, factura.timbrado.uuid, motivoSat, folioSustitucion);
  } catch (error) {
    if (error instanceof ErrorSw)
      throw new ErrorTimbrado(`El SAT no aceptó la cancelación: ${error.message}`, [
        error.detalle || error.message,
      ]);
    throw error;
  }

  factura.timbrado.estado = "cancelada_sat";
  factura.timbrado.motivoCancelacionSat = motivoSat;
  factura.timbrado.folioSustitucion = folioSustitucion;
  factura.timbrado.canceladoSatEn = new Date();
  factura.timbrado.acuseCancelacion = JSON.stringify(acuse ?? {}).slice(0, 20000);
  factura.estado = "cancelada";
  factura.motivoCancelacion = motivo;
  factura.canceladaEn = new Date();
  factura.canceladaPorId = usuarioId;
  await factura.save();
  return factura;
}
