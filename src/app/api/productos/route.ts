import { validarFiscalProducto } from "@/lib/fiscalProducto";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Producto from "@/models/Producto";
import { requireSession, unauthorized, forbidden, badRequest } from "@/lib/apiAuth";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Los productos creados antes de agregar los campos "alias" y "anaquel" no los
// tienen en Mongo (los defaults del schema no aplican retroactivamente a
// documentos existentes).
function normalizado<T extends { alias?: string[]; anaquel?: string }>(
  producto: T
): T & { alias: string[]; anaquel: string } {
  return { ...producto, alias: producto.alias ?? [], anaquel: producto.anaquel ?? "" };
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();

  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  const campos = session.perfilDocumentoId && !["web-administrador", "web-compras"].includes(session.perfilDocumentoId) ? "-precioCompra" : "";

  // Sin "page": comportamiento original, devuelve el catálogo completo. Lo usan
  // el punto de venta y el combobox de pedidos, que necesitan la lista completa
  // en el cliente para buscar/escanear al instante sin ida y vuelta al servidor.
  if (!pageParam) {
    const productos = await Producto.find({ activo: true }).select(campos).sort({ nombre: 1 }).lean();
    return NextResponse.json(productos.map(normalizado));
  }

  // Con "page": paginación y búsqueda en el servidor, para el catálogo de
  // matriz (miles de productos) donde no tiene sentido mandar todo al cliente.
  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const q = url.searchParams.get("q")?.trim();
  const categoria = url.searchParams.get("categoria")?.trim();
  // Para recorrer el CEDIS acomodando producto: lista ordenada por ubicación.
  const orden: Record<string, 1> =
    url.searchParams.get("orden") === "anaquel" ? { anaquel: 1, nombre: 1 } : { nombre: 1 };

  const filter: Record<string, unknown> = { activo: true };
  if (categoria) filter.categoria = categoria;
  if (q) {
    const regex = new RegExp(escapeRegExp(q), "i");
    filter.$or = [{ nombre: regex }, { sku: regex }, { alias: regex }, { anaquel: regex }];
  }

  const [items, total] = await Promise.all([
    Producto.find(filter)
      .select(campos)
      .sort(orden)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Producto.countDocuments(filter),
  ]);

  return NextResponse.json({ items: items.map(normalizado), total });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  if (!body?.sku || !body?.nombre || !body?.categoria || !body?.unidad) {
    return badRequest("Faltan campos requeridos (sku, nombre, categoria, unidad)");
  }

  let fiscal;
  if (body.fiscal !== undefined) {
    try { fiscal = validarFiscalProducto(body.fiscal); } catch (e) { return badRequest((e as Error).message); }
  }
  const alias: string[] = Array.isArray(body.alias)
    ? body.alias.map((a: string) => String(a).trim()).filter(Boolean)
    : [];

  await connectDB();
  const producto = await Producto.create({
    sku: body.sku,
    ...(fiscal ? { fiscal } : {}),
    nombre: body.nombre,
    alias,
    area: typeof body.area === "string" ? body.area.trim().slice(0, 100) : "",
    linea: body.linea || "",
    categoria: body.categoria,
    anaquel: String(body.anaquel ?? "").trim(),
    unidad: body.unidad,
    requierePesaje: Boolean(body.requierePesaje),
    precioCompra: Number(body.precioCompra) || 0,
    precioVenta: Number(body.precioVenta) || 0,
    existenciaMatriz: Number(body.existenciaMatriz) || 0,
    stockMinimo: Number(body.stockMinimo) || 0,
    stockMaximo: Number(body.stockMaximo) || 0,
  });

  return NextResponse.json(producto, { status: 201 });
}
