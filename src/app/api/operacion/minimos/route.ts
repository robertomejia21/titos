import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Producto from "@/models/Producto";
import { badRequest } from "@/lib/apiAuth";
import { sesionOperacion } from "@/lib/operacionApi";
import { tablaMinimos } from "@/lib/minimosServidor";

export async function GET(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar", "compras.administrar");
  if (error) return error;
  const p = req.nextUrl.searchParams;
  const tabla = await tablaMinimos({
    q: p.get("q")?.trim() || undefined,
    soloClave: p.get("clave") === "1",
    soloBajo: p.get("bajo") === "1",
    soloPerecederos: p.get("perecederos") === "1",
  });
  const page = Math.max(1, Number(p.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(p.get("pageSize")) || 50));
  return NextResponse.json({
    ...tabla,
    total: tabla.items.length,
    bajoMinimo: tabla.items.filter((i) => i.bajoMinimo).length,
    items: tabla.items.slice((page - 1) * pageSize, page * pageSize),
  });
}

const CAMPOS_ENTEROS = ["piezasPorCaja", "cajasPorTarima", "vidaUtilDias"] as const;
const CAMPOS_NUMERICOS = ["stockMinimo", "stockMaximo", "minimoTemporadaAlta"] as const;

/** Guarda en bloque lo que se editó en la tabla. */
export async function PATCH(req: NextRequest) {
  const { error } = await sesionOperacion(req, "inventario.administrar");
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.cambios) || !body.cambios.length || body.cambios.length > 500) return badRequest("Sin cambios que guardar");
  const operaciones = [];
  for (const cambio of body.cambios) {
    if (!mongoose.isValidObjectId(cambio?.productoId)) return badRequest("Producto inválido");
    const set: Record<string, unknown> = {};
    for (const campo of CAMPOS_ENTEROS) {
      if (!(campo in cambio)) continue;
      const v = Number(cambio[campo]);
      if (!Number.isInteger(v) || v < 0 || v > 100000) return badRequest("Piezas por caja, cajas por tarima y vida útil deben ser enteros mayores o iguales a cero");
      set[campo] = v;
    }
    for (const campo of CAMPOS_NUMERICOS) {
      if (!(campo in cambio)) continue;
      const v = Number(cambio[campo]);
      if (!Number.isFinite(v) || v < 0 || v > 10000000) return badRequest("Los mínimos y máximos deben ser números mayores o iguales a cero");
      set[campo] = v;
    }
    if ("esClave" in cambio) set.esClave = cambio.esClave === true;
    if (typeof set.stockMinimo === "number" && typeof set.stockMaximo === "number" && set.stockMaximo > 0 && set.stockMaximo < set.stockMinimo) {
      return badRequest("El máximo no puede ser menor que el mínimo");
    }
    if (Object.keys(set).length) operaciones.push({ updateOne: { filter: { _id: cambio.productoId }, update: { $set: set } } });
  }
  if (!operaciones.length) return NextResponse.json({ actualizados: 0 });
  const resultado = await Producto.bulkWrite(operaciones);
  return NextResponse.json({ actualizados: resultado.modifiedCount });
}
