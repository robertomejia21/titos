export type FiscalProducto = {
  iva: "pendiente" | "exento" | "0" | "8" | "16";
  iepsTipo: "pendiente" | "no_aplica" | "porcentaje" | "cuota";
  iepsValor: number;
  claveProdServ: string;
  precioImpuestos: "pendiente" | "sin_impuestos" | "incluidos";
};
export const FISCAL_INICIAL: FiscalProducto = { iva: "pendiente", iepsTipo: "pendiente", iepsValor: 0, claveProdServ: "", precioImpuestos: "sin_impuestos" };
export function validarFiscalProducto(valor: unknown): FiscalProducto {
  if (!valor || typeof valor !== "object") throw new Error("Revisa los datos fiscales del producto.");
  const f = valor as FiscalProducto;
  if (!["pendiente", "exento", "0", "8", "16"].includes(f.iva)) throw new Error("Elige una tasa de IVA válida.");
  if (!["pendiente", "no_aplica", "porcentaje", "cuota"].includes(f.iepsTipo)) throw new Error("Elige cómo registrar el IEPS.");
  if (!["pendiente", "sin_impuestos", "incluidos"].includes(f.precioImpuestos)) throw new Error("Indica si el precio incluye impuestos.");
  if (typeof f.claveProdServ !== "string" || (f.claveProdServ !== "" && !/^\d{8}$/.test(f.claveProdServ))) throw new Error("La clave SAT debe tener ocho dígitos o quedar pendiente.");
  if (typeof f.iepsValor !== "number" || !Number.isFinite(f.iepsValor) || f.iepsValor < 0 || f.iepsValor > (f.iepsTipo === "porcentaje" ? 100 : 1000000)) throw new Error("Revisa la tasa o cuota de IEPS.");
  return { iva: f.iva, iepsTipo: f.iepsTipo, iepsValor: ["pendiente", "no_aplica"].includes(f.iepsTipo) ? 0 : f.iepsValor, claveProdServ: f.claveProdServ, precioImpuestos: f.precioImpuestos };
}
