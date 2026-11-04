import Producto from "@/models/Producto";
import Proveedor from "@/models/Proveedor";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { obtenerConfiguracionOperacion, zonaCedis } from "@/lib/operacion";
import { sendMessage } from "@/lib/greenApi";
import { fechaEnZona } from "@/lib/zonasHorarias";
import { estadoTemporada, iniciaHoy, textoMesDia } from "@/lib/temporadas";

/** Productos marcados de temporada con su estado de hoy. */
export async function listarTemporadas() {
  const hoy = fechaEnZona(new Date(), await zonaCedis());
  const productos = await Producto.find({ "temporada.activa": true }).select("sku nombre categoria existenciaMatriz temporada proveedorPreferidoId").sort({ nombre: 1 }).lean();
  return {
    fecha: hoy,
    productos: productos.map((p) => ({
      _id: String(p._id),
      sku: p.sku,
      nombre: p.nombre,
      categoria: p.categoria,
      existenciaMatriz: p.existenciaMatriz,
      inicio: p.temporada?.inicio ?? "",
      fin: p.temporada?.fin ?? "",
      estado: estadoTemporada(p.temporada, hoy, p.existenciaMatriz ?? 0),
    })),
  };
}

const normalizar = (c: string) => c.toLowerCase().replaceAll("_", " ").trim();

/**
 * El día que arranca una temporada avisa por WhatsApp a Compras, al grupo de
 * faltantes de su categoría y (si está prendido el envío a proveedores) a su
 * proveedor preferido. Un aviso por producto por año. Lo llama el cron.
 */
export async function avisarInicioDeTemporadas(ahora = new Date()) {
  const hoy = fechaEnZona(ahora, await zonaCedis());
  const anio = Number(hoy.slice(0, 4));
  const candidatos = (await Producto.find({ "temporada.activa": true, "temporada.avisadoAnio": { $ne: anio } }).select("nombre categoria existenciaMatriz temporada proveedorPreferidoId").lean()).filter((p) =>
    iniciaHoy(p.temporada, hoy)
  );
  if (!candidatos.length) return { avisados: 0, mensajes: 0, errores: [] as string[] };

  const [config, operacion] = await Promise.all([obtenerConfiguracion(), obtenerConfiguracionOperacion()]);
  const compras = (config.alertas?.destinatariosCompras ?? []).filter((d: string) => d.trim());
  const grupos = (operacion.faltantesDiarios?.segmentos ?? []) as { categorias?: string[]; destinatarios?: string[] }[];
  const proveedores = new Map(
    (await Proveedor.find({ _id: { $in: candidatos.map((p) => p.proveedorPreferidoId).filter(Boolean) } }).select("whatsapp").lean()).map((p) => [String(p._id), p.whatsapp as string])
  );

  const errores: string[] = [];
  let mensajes = 0;
  for (const p of candidatos) {
    const texto = `*Arranca la temporada de ${p.nombre}* (${textoMesDia(p.temporada?.inicio)} al ${textoMesDia(p.temporada?.fin)}). Las tiendas ya lo pueden pedir. Existencia en CEDIS: ${p.existenciaMatriz}.`;
    const delGrupo = grupos.filter((g) => (g.categorias ?? []).some((c) => normalizar(c) === normalizar(p.categoria))).flatMap((g) => g.destinatarios ?? []);
    const proveedor = operacion.faltantesDiarios?.enviarAProveedores === true && p.proveedorPreferidoId ? proveedores.get(String(p.proveedorPreferidoId)) : "";
    const numeros = [...new Set([...compras, ...delGrupo, ...(proveedor ? [proveedor] : [])])];
    for (const numero of numeros) {
      try {
        await sendMessage(numero, texto);
        mensajes++;
      } catch (error) {
        errores.push(`${numero}: ${(error as Error).message}`);
      }
    }
    // Se marca aunque no haya destinatarios: el aviso es de ese día y no se repite.
    await Producto.updateOne({ _id: p._id }, { $set: { "temporada.avisadoAnio": anio } });
  }
  return { avisados: candidatos.length, mensajes, errores };
}
