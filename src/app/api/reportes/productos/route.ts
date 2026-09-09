import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, forbidden, puede, badRequest } from "@/lib/apiAuth";
import { connectDB } from "@/lib/db";
import { filtrosProductos, obtenerReporteProductos } from "@/lib/reporteProductos";
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "reportes.ver")) return forbidden();
  let filtros;
  try { filtros = filtrosProductos(req.nextUrl.searchParams); }
  catch (error) { return badRequest((error as Error).message); }
  try {
    await connectDB();
    return NextResponse.json(await obtenerReporteProductos(filtros));
  } catch (error) {
    console.error("Error al comparar ventas por producto", error);
    return NextResponse.json({error: "No se pudo consultar el reporte. Intenta nuevamente."}, {status: 500});
  }
}
