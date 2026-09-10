import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth";
import { PERMISOS, tienePermiso } from "@/lib/permisos";
import { fechaEnZona, ZONA_HORARIA_DEFAULT } from "@/lib/zonasHorarias";
import { sesionVigente } from "./sesionVigente";
import { accesoApiPuesto } from "./accesoPuestos";

export async function requireSession(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await sesionVigente(await verifySession(token));
  return session && accesoApiPuesto(session, req.nextUrl.pathname, req.method) ? session : null;
}

export function unauthorized() {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
}

/**
 * ¿La sesión tiene este permiso? Es la misma función que usan el menú y el
 * proxy, para que lo que se ve y lo que se puede hacer no se separen.
 */
export function puede(session: SessionPayload, permiso: string) {
  return tienePermiso(session, permiso);
}

/** 403 con el nombre del permiso que faltó, para que el error sea accionable. */
export function sinPermiso(permiso: string) {
  const etiqueta = PERMISOS.find((p) => p.clave === permiso)?.etiqueta;
  return NextResponse.json(
    { error: etiqueta ? `Tu rol no incluye el permiso: ${etiqueta}` : "No tienes permiso para esta acción" },
    { status: 403 }
  );
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "No encontrado") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function generateFolio(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

/**
 * Día de corte (YYYY-MM-DD) con el que se sella una venta, retiro, abono o
 * pedido. Debe calcularse en la zona horaria de la sucursal: en UTC, todo lo
 * vendido después de las 5 p.m. en Tijuana caería en el corte del día siguiente.
 */
export function todayCorte(zona: string = ZONA_HORARIA_DEFAULT) {
  return fechaEnZona(new Date(), zona);
}
