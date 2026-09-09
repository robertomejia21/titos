import { Types, type PipelineStage } from "mongoose";
import Venta from "@/models/Venta";
import Sucursal from "@/models/Sucursal";
import { regexBusqueda } from "@/lib/busqueda";

export type FiltrosProductos = {desde: string; hasta: string; sucursal: string; q: string; unidad: string; notas: string; medida: string; orden: string; pagina: number};
export function filtrosProductos(params: URLSearchParams): FiltrosProductos {
  const desde = params.get("desde") ?? "";
  const hasta = params.get("hasta") ?? "";
  const fechaValida = (valor: string) => /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor;
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) throw new Error("Selecciona un rango válido de fechas");
  const sucursal = params.get("sucursal") ?? "";
  if (sucursal && !/^[a-f\d]{24}$/i.test(sucursal)) throw new Error("Sucursal inválida");
  const opcion = (clave: string, permitidos: string[], defecto: string) => {
    const valor = params.get(clave) || defecto;
    if (!permitidos.includes(valor)) throw new Error(`Filtro inválido: ${clave}`);
    return valor;
  };
  const unidad = opcion("unidad", ["pieza", "kg", "todas"], "pieza");
  const medida = opcion("medida", ["cantidad", "importe"], "cantidad");
  if (unidad === "todas" && medida === "cantidad") throw new Error("Para ordenar por cantidad, elige piezas o kilos");
  const pagina = Number(params.get("pagina") || 1);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw new Error("Página inválida");
  return {desde, hasta, sucursal, q: (params.get("q") ?? "").trim().slice(0, 120), unidad, medida, notas: opcion("notas", ["excluir", "incluir", "solo"], "excluir"), orden: opcion("orden", ["desc", "asc"], "desc"), pagina};
}

export async function obtenerReporteProductos(f: FiltrosProductos) {
  const match: Record<string, unknown> = {estado: "completada", corte: {$gte: f.desde, $lte: f.hasta}};
  if (f.sucursal) match.sucursalId = new Types.ObjectId(f.sucursal);
  if (f.notas !== "incluir") match.esVentas2 = f.notas === "solo" ? true : {$ne: true};
  const filtroItem: Record<string, unknown> = {};
  if (f.unidad !== "todas") filtroItem["items.unidad"] = f.unidad;
  if (f.q) filtroItem.$and = f.q.split(/\s+/).map((token) => ({$or: [{"items.sku": regexBusqueda(token)}, {"items.nombreProducto": regexBusqueda(token)}]}));
  const sumas = {cantidad: {$sum: "$cantidad"}, importe: {$sum: "$importe"}, piezas: {$sum: {$cond: [{$eq: ["$_id.unidad", "pieza"]}, "$cantidad", 0]}}, kg: {$sum: {$cond: [{$eq: ["$_id.unidad", "kg"]}, "$cantidad", 0]}}};
  const pipeline: PipelineStage[] = [
    {$match: match}, {$unwind: "$items"}, {$match: filtroItem},
    {$group: {_id: {producto: "$items.productoId", sku: "$items.sku", unidad: "$items.unidad", sucursal: "$sucursalId"}, nombre: {$max: "$items.nombreProducto"}, cantidad: {$sum: "$items.cantidad"}, importe: {$sum: "$items.subtotal"}}},
    {$facet: {
      filas: [{$group: {_id: {producto: "$_id.producto", sku: "$_id.sku", unidad: "$_id.unidad"}, nombre: {$max: "$nombre"}, cantidad: {$sum: "$cantidad"}, importe: {$sum: "$importe"}, sucursales: {$push: {id: "$_id.sucursal", cantidad: "$cantidad", importe: "$importe"}}}}, {$sort: {[f.medida]: f.orden === "desc" ? -1 : 1, "_id.sku": 1, "_id.producto": 1, "_id.unidad": 1}}, {$skip: (f.pagina - 1) * 50}, {$limit: 50}],
      conteo: [{$group: {_id: {producto: "$_id.producto", sku: "$_id.sku", unidad: "$_id.unidad"}}}, {$count: "total"}],
      totales: [{$group: {_id: null, ...sumas}}],
      porSucursal: [{$group: {_id: "$_id.sucursal", ...sumas}}],
    }},
  ];
  const [resultados, sucursales] = await Promise.all([Venta.aggregate(pipeline).allowDiskUse(true), Sucursal.find({}).select("nombre esMatriz").sort({nombre: 1}).lean()]);
  const resultado = resultados[0];
  const conocidas = new Map(sucursales.map((s) => [String(s._id), {id: String(s._id), nombre: s.nombre as string}]));
  for (const s of resultado.porSucursal) if (!conocidas.has(String(s._id))) conocidas.set(String(s._id), {id: String(s._id), nombre: "Sucursal no disponible"});
  return {filas: resultado.filas, total: resultado.conteo[0]?.total ?? 0, pagina: f.pagina, porPagina: 50, totales: resultado.totales[0] ?? {importe: 0, piezas: 0, kg: 0}, porSucursal: resultado.porSucursal, sucursales: [...conocidas.values()].filter((s) => !f.sucursal || s.id === f.sucursal)};
}
