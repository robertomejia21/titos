import type { FiscalProducto } from "./fiscalProducto";
import type { ReglasOperacion } from "./reglasOperacion";
export type DetalleCostoRecepcion = ReturnType<typeof costoRecepcion> & {productoId:string; nombre:string; sku:string; unidad:string; cantidad:number; costo:number; fiscal: FiscalProducto};
export type RecepcionCostos = {folio?:string;sucursalNombre?:string;moneda:string;tipoCambio:number;servicio:number;descuento:number;observaciones:string;subtotal:number;iva:number;ieps:number;total:number;detalle:DetalleCostoRecepcion[]};

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export function costoRecepcion(cantidad: number, costo: number, fiscal: FiscalProducto, reglas: ReglasOperacion) {
  if (![cantidad,costo].every(v=>Number.isFinite(v)&&v>=0) || cantidad*costo>1e12) throw new Error("Revisa cantidad y costo de recepción.");
  if (reglas.costosCompra === "pendiente" || reglas.baseIvaCompra === "pendiente") throw new Error("Administración debe configurar las reglas de impuestos de compras.");
  if (!fiscal || fiscal.iva === "pendiente" || fiscal.iepsTipo === "pendiente") throw new Error("Compras debe definir los impuestos del producto antes de recibirlo.");
  if (fiscal.iepsTipo === "cuota") throw new Error("Las cuotas de IEPS requieren definir su unidad fiscal antes de recibir este producto.");
  const ivaTasa = fiscal.iva === "exento" ? 0 : Number(fiscal.iva)/100;
  const iepsTasa = fiscal.iepsTipo === "porcentaje" ? fiscal.iepsValor/100 : 0;
  const factor = 1 + iepsTasa + ivaTasa*(reglas.baseIvaCompra === "costo_ieps" ? 1+iepsTasa : 1);
  const bruto = centavos(cantidad*costo);
  const subtotal = reglas.costosCompra === "incluidos" ? centavos(bruto/factor) : bruto;
  const ieps = centavos(subtotal*iepsTasa);
  const iva = centavos((subtotal+(reglas.baseIvaCompra === "costo_ieps" ? ieps : 0))*ivaTasa);
  const total = reglas.costosCompra === "incluidos" ? bruto : centavos(subtotal+ieps+iva);
  return {subtotal: reglas.costosCompra === "incluidos" ? centavos(total-ieps-iva) : subtotal, iva, ieps, total};
}
