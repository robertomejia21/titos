import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, puede } from "@/lib/apiAuth";
import { contextoPuntoVenta, sucursalConsultada } from "@/lib/puntoVenta";
import { validarEquipoCaja } from "@/lib/equiposCaja";
import { normalizarNumeroCaja } from "@/lib/numeroCaja";
import { cajasDeSucursal, liberarCaja, migrarEquiposCaja } from "@/lib/cajaComputadora";
import EquipoCaja from "@/models/EquipoCaja";
import Sucursal from "@/models/Sucursal";
import TerminalPago from "@/models/TerminalPago";

// Ficha de equipos de UNA caja (báscula, escáner, terminal). Cada caja de la
// sucursal tiene la suya.
//
// GET ?sucursalId=&numeroCaja= — administración elige sucursal y caja. Desde
// el punto de venta, sin numeroCaja, regresa la caja de esta computadora.

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  await connectDB();
  await migrarEquiposCaja();
  const admin = session.role === "matriz" && puede(session, "configuracion.editar");
  const id = await sucursalConsultada(session, admin ? req.nextUrl : new URL(req.nextUrl.origin));
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return badRequest("Sucursal inválida");

  let numeroCaja = normalizarNumeroCaja(req.nextUrl.searchParams.get("numeroCaja"));
  if (!numeroCaja) {
    const ctx = await contextoPuntoVenta(session, req);
    numeroCaja = ctx && ctx.sucursalId === id && ctx.numeroCaja ? ctx.numeroCaja : 1;
  }

  const [sucursales, equipo, terminales, asignacion] = await Promise.all([
    Sucursal.find(admin ? {} : { _id: id }).select("nombre").sort({ nombre: 1 }).lean(),
    EquipoCaja.findOne({ sucursalId: id, numeroCaja }).select("-computadoraHash").lean(),
    TerminalPago.find({ sucursalId: id, activo: true }).select("alias banco marca").lean(),
    cajasDeSucursal(req, id),
  ]);
  return NextResponse.json({
    sucursalId: id,
    sucursales,
    numeroCaja,
    cajas: asignacion.cajas,
    // Ficha vacía todavía (caja creada solo por asignarle computadora): se
    // manda como si no existiera para que la pantalla parta de cero.
    equipo: equipo && (equipo as { configuracion?: unknown }).configuracion ? equipo : null,
    terminales,
    puedeEditar: admin && !session.permisosSoloConsulta?.includes("configuracion.editar"),
  });
}

export async function PUT(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (session.role !== "matriz" || !puede(session, "configuracion.editar") || session.permisosSoloConsulta?.includes("configuracion.editar")) return forbidden();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.sucursalId !== "string" || !/^[a-f0-9]{24}$/i.test(body.sucursalId)) return badRequest("Elige una sucursal válida");
  const numeroCaja = normalizarNumeroCaja(body.numeroCaja ?? 1);
  if (!numeroCaja) return badRequest("Elige un número de caja válido");
  await connectDB();
  await migrarEquiposCaja();
  if (!await Sucursal.exists({ _id: body.sucursalId })) return badRequest("La sucursal no existe");

  // Soltar la computadora de una caja: la PC se descompuso o se reemplazó y la
  // nueva tiene que poder tomar ese número.
  if (body.accion === "liberar") {
    await liberarCaja(body.sucursalId, numeroCaja);
    return NextResponse.json({ ok: true });
  }

  let configuracion;
  try { configuracion = validarEquipoCaja(body.configuracion); } catch (e) { return badRequest((e as Error).message); }
  if (configuracion.terminalId && !await TerminalPago.exists({ _id: configuracion.terminalId, sucursalId: body.sucursalId, activo: true })) return badRequest("La terminal debe estar activa y pertenecer a esta sucursal");
  // Una terminal física está en una sola caja.
  if (configuracion.terminalId) {
    const otra = await EquipoCaja.findOne({ sucursalId: body.sucursalId, numeroCaja: { $ne: numeroCaja }, "configuracion.terminalId": configuracion.terminalId }).select("numeroCaja").lean<{ numeroCaja?: number } | null>();
    if (otra) return badRequest(`Esa terminal ya está asignada a la Caja ${otra.numeroCaja ?? 1}`);
  }
  const equipo = await EquipoCaja.findOneAndUpdate(
    { sucursalId: body.sucursalId, numeroCaja },
    { $set: { configuracion, actualizadoPor: session.nombre } },
    { upsert: true, returnDocument: "after", projection: { computadoraHash: 0 } }
  );
  return NextResponse.json(equipo);
}
