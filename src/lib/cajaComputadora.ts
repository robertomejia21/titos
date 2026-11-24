import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import EquipoCaja from "@/models/EquipoCaja";
import CajaSesion from "@/models/CajaSesion";
import { COOKIE_COMPUTADORA, filtroCajaAbierta } from "@/lib/numeroCaja";

// Asignación computadora ↔ caja. Ver lib/numeroCaja para el porqué.

type ConCookies = { cookies: { get(nombre: string): { value: string } | undefined } };

export class ErrorAsignacionCaja extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function hashComputadora(id: string) {
  return createHash("sha256").update(id).digest("hex");
}

function idDeComputadora(req?: ConCookies | null): string | null {
  const valor = req?.cookies.get(COOKIE_COMPUTADORA)?.value ?? "";
  return /^[a-f0-9]{48}$/.test(valor) ? valor : null;
}

// Antes había un registro de equipo por sucursal con índice único en
// `sucursalId`. Ese índice impide tener la Caja 2, así que se quita y el
// registro viejo queda como Caja 1. Corre una vez por proceso.
let migracion: Promise<void> | null = null;
export function migrarEquiposCaja() {
  migracion ??= (async () => {
    try {
      await EquipoCaja.collection.dropIndex("sucursalId_1");
    } catch {
      // Ya no existe (o la colección todavía no existe): nada que hacer.
    }
    await EquipoCaja.updateMany({ numeroCaja: { $exists: false } }, { $set: { numeroCaja: 1 } });
    await EquipoCaja.createIndexes();
  })().catch((err) => {
    migracion = null;
    throw err;
  });
  return migracion;
}

/**
 * Caja de la computadora que hace la petición, en esa sucursal.
 *
 * Mientras la sucursal no tenga NINGUNA computadora asignada se sigue
 * comportando como antes (todo es la Caja 1): así no se traba la operación el
 * día del cambio ni las integraciones que no pasan por el navegador de caja. En
 * cuanto una computadora toma su caja, las que no tienen asignación ya no
 * pueden operar caja hasta elegir la suya.
 */
export async function numeroCajaDeComputadora(req: ConCookies | null | undefined, sucursalId: string): Promise<number | null> {
  const id = idDeComputadora(req);
  if (id) {
    const equipo = await EquipoCaja.findOne({ sucursalId, computadoraHash: hashComputadora(id) })
      .select("numeroCaja")
      .lean<{ numeroCaja?: number } | null>();
    if (equipo) return equipo.numeroCaja ?? 1;
  }
  const hayAsignadas = await EquipoCaja.exists({ sucursalId, computadoraHash: { $type: "string" } });
  return hayAsignadas ? null : 1;
}

/** Cajas de la sucursal y cuál es de esta computadora. */
export async function cajasDeSucursal(req: ConCookies | null | undefined, sucursalId: string) {
  await migrarEquiposCaja();
  const id = idDeComputadora(req);
  const hash = id ? hashComputadora(id) : null;
  const equipos = await EquipoCaja.find({ sucursalId })
    .select("numeroCaja computadoraHash computadoraAsignadaEn computadoraUltimaVez configuracion.nombreCaja")
    .sort({ numeroCaja: 1 })
    .lean<{ numeroCaja?: number; computadoraHash?: string | null; computadoraAsignadaEn?: Date | null; computadoraUltimaVez?: Date | null; configuracion?: { nombreCaja?: string } | null }[]>();
  const propia = hash ? equipos.find((e) => e.computadoraHash === hash) : undefined;
  if (propia && hash) {
    await EquipoCaja.updateOne({ sucursalId, computadoraHash: hash }, { $set: { computadoraUltimaVez: new Date() } });
  }
  return {
    numeroCaja: propia ? propia.numeroCaja ?? 1 : null,
    cajas: equipos.map((e) => ({
      numeroCaja: e.numeroCaja ?? 1,
      nombreCaja: e.configuracion?.nombreCaja ?? "",
      asignada: !!e.computadoraHash,
      esEstaComputadora: !!hash && e.computadoraHash === hash,
      asignadaEn: e.computadoraAsignadaEn ?? null,
      ultimaVez: e.computadoraUltimaVez ?? null,
    })),
  };
}

/**
 * Asigna la caja `numeroCaja` a la computadora de la petición. Devuelve el
 * identificador de la computadora (nuevo si no traía) para guardarlo en la cookie.
 *
 * - Si la caja ya es de OTRA computadora, solo se toma con `reemplazo` (el
 *   gerente autorizó con su NIP: la computadora vieja se descompuso o se cambió).
 * - Si esta computadora era otra caja, la suelta, salvo que esa caja tenga
 *   turno abierto: primero se hace el corte.
 */
export async function asignarCajaAComputadora({
  req,
  sucursalId,
  numeroCaja,
  asignadaPor,
  reemplazo,
}: {
  req: ConCookies;
  sucursalId: string;
  numeroCaja: number;
  asignadaPor: string;
  reemplazo: boolean;
}): Promise<{ computadoraId: string; numeroCaja: number }> {
  await migrarEquiposCaja();
  const computadoraId = idDeComputadora(req) ?? randomBytes(24).toString("hex");
  const hash = hashComputadora(computadoraId);

  const actual = await EquipoCaja.findOne({ computadoraHash: hash })
    .select("sucursalId numeroCaja")
    .lean<{ sucursalId: unknown; numeroCaja?: number } | null>();
  if (actual && String(actual.sucursalId) === String(sucursalId) && (actual.numeroCaja ?? 1) === numeroCaja) {
    return { computadoraId, numeroCaja };
  }

  const destino = await EquipoCaja.findOne({ sucursalId, numeroCaja })
    .select("computadoraHash")
    .lean<{ computadoraHash?: string | null } | null>();
  if (destino?.computadoraHash && destino.computadoraHash !== hash && !reemplazo) {
    throw new ErrorAsignacionCaja(
      `La Caja ${numeroCaja} ya es otra computadora. Si esa computadora se reemplazó, el gerente puede reasignarla con su NIP.`
    );
  }

  if (actual) {
    const abierta = await CajaSesion.exists(filtroCajaAbierta({ sucursalId: actual.sucursalId, numeroCaja: actual.numeroCaja ?? 1 }));
    if (abierta) {
      throw new ErrorAsignacionCaja(
        `Esta computadora tiene abierta la Caja ${actual.numeroCaja ?? 1}. Haz el corte antes de cambiarla de caja.`
      );
    }
    await EquipoCaja.updateOne({ computadoraHash: hash }, { $set: { computadoraHash: null } });
  }

  try {
    await EquipoCaja.findOneAndUpdate(
      { sucursalId, numeroCaja },
      {
        $set: {
          computadoraHash: hash,
          computadoraAsignadaEn: new Date(),
          computadoraAsignadaPor: asignadaPor,
          computadoraUltimaVez: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new ErrorAsignacionCaja("Otra computadora tomó esa caja al mismo tiempo. Vuelve a intentarlo.");
    }
    throw err;
  }
  return { computadoraId, numeroCaja };
}

/** Deja la caja sin computadora (administración, desde Equipos de caja). */
export async function liberarCaja(sucursalId: string, numeroCaja: number) {
  await migrarEquiposCaja();
  await EquipoCaja.updateOne({ sucursalId, numeroCaja }, { $set: { computadoraHash: null, computadoraAsignadaEn: null } });
}

export function ponerCookieComputadora(res: NextResponse, computadoraId: string) {
  res.cookies.set(COOKIE_COMPUTADORA, computadoraId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Diez años: es la identidad de la computadora, no la sesión del usuario.
    maxAge: 60 * 60 * 24 * 365 * 10,
  });
}
