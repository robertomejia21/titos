import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { DIAS_SEMANA } from "@/lib/dias";
import { requireSession, unauthorized, forbidden, badRequest, puede, sinPermiso } from "@/lib/apiAuth";
import { hashPassword } from "@/lib/auth";
import {
  NIP_CREACION_SUPERVISOR_REGEX,
  NIP_SUPERVISOR_REGEX,
  obtenerConfiguracion,
  reglasDolaresDe,
} from "@/lib/configuracion";
import { hayNipsDeSupervisor } from "@/lib/supervisores";
import { contextoPuntoVenta } from "@/lib/puntoVenta";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();

  await connectDB();
  const config = await obtenerConfiguracion();
  const nipCreacionSupervisorConfigurado = !!config.nipCreacionSupervisorHash;
  // "Hay NIP" para el punto de venta significa que hay CON QUÉ autorizar: el NIP
  // general de la cadena o el personal de algún encargado de turno. Con
  // cualquiera de los dos, el mostrador debe pedirlo al cancelar.
  // Se pregunta por la tienda en la que opera la sesión (la sucursal, o el
  // mostrador si quien consulta es matriz) para no exigir un NIP que ningún
  // encargado de ESA tienda tiene.
  const ctx = await contextoPuntoVenta(session);
  const nipSupervisorConfigurado =
    !!config.nipSupervisorHash || (await hayNipsDeSupervisor(ctx?.sucursalId));

  // Las sucursales solo necesitan el tipo de cambio y las reglas de dólares (las
  // usa el punto de venta), y saber si ya hay un NIP de supervisor con el que
  // autorizar cancelaciones.
  if (session.role !== "matriz") {
    return NextResponse.json({
      tipoCambio: config.tipoCambio ?? 17,
      fondoCajaMxn: config.fondoCajaMxn ?? 1000,
      // Se manda cuándo se actualizó para que el punto de venta pueda avisar
      // que el tipo de cambio ya tiene días sin moverse.
      tipoCambioActualizadoEn: config.tipoCambioActualizadoEn ?? null,
      dolares: reglasDolaresDe(config),
      nipSupervisorConfigurado,
    });
  }

  // Los hashes de los NIP nunca salen de la API.
  const objeto = config.toObject();
  delete objeto.nipSupervisorHash;
  delete objeto.nipCreacionSupervisorHash;
  return NextResponse.json({ ...objeto, nipSupervisorConfigurado, nipCreacionSupervisorConfigurado });
}

export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return unauthorized();
  if (!puede(session, "configuracion.editar")) return sinPermiso("configuracion.editar");
  if (session.role !== "matriz") return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Cuerpo inválido");

  const update: Record<string, unknown> = {};
  if ("fondoCajaMxn" in body) {
    const fondo = body.fondoCajaMxn;
    if (typeof fondo !== "number" || !Number.isFinite(fondo) || fondo < 0 || fondo > 1000000 || Math.abs(fondo * 100 - Math.round(fondo * 100)) > 0.00001) return badRequest("El fondo debe ser de 0 a 1,000,000 de pesos, con hasta dos decimales.");
    update.fondoCajaMxn = fondo;
  }
  if ("diasLaborales" in body) {
    if (!Array.isArray(body.diasLaborales) || body.diasLaborales.some((d: unknown) => !DIAS_SEMANA.includes(d as typeof DIAS_SEMANA[number]))) {
      return badRequest("Días laborales inválidos");
    }
    update.diasLaborales = body.diasLaborales;
  }
  if ("horaCorte" in body) {
    if (!/^\d{2}:\d{2}$/.test(body.horaCorte)) return badRequest("Hora de corte inválida (usa formato HH:MM)");
    update.horaCorte = body.horaCorte;
  }
  if ("tipoCambio" in body) {
    const tipoCambio = Number(body.tipoCambio);
    if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) return badRequest("Tipo de cambio inválido");
    update.tipoCambio = tipoCambio;
    // Se sella quién lo movió y cuándo: el punto de venta lo muestra junto al
    // importe en dólares para que nadie cobre con el de hace tres semanas.
    update.tipoCambioActualizadoEn = new Date();
    update.tipoCambioActualizadoPor = session.nombre ?? "";
  }
  if ("dolares" in body) {
    const dolares = body.dolares ?? {};
    const denominacionMaxima = Number(dolares.denominacionMaxima ?? 0);
    const porcentajeMaximo = Number(dolares.porcentajeMaximo ?? 0);
    const montoMaximoUsd = Number(dolares.montoMaximoUsd ?? 0);
    if (!Number.isFinite(denominacionMaxima) || denominacionMaxima < 0) {
      return badRequest("La denominación máxima de dólares debe ser un número mayor o igual a cero");
    }
    if (!Number.isFinite(porcentajeMaximo) || porcentajeMaximo < 0 || porcentajeMaximo > 100) {
      return badRequest("El porcentaje máximo a pagar en dólares debe ir de 0 a 100");
    }
    if (!Number.isFinite(montoMaximoUsd) || montoMaximoUsd < 0) {
      return badRequest("El monto máximo en dólares debe ser un número mayor o igual a cero");
    }
    update.dolares = {
      aceptaPagos: dolares.aceptaPagos !== false,
      denominacionMaxima,
      porcentajeMaximo,
      montoMaximoUsd,
    };
  }
  if ("alertas" in body) {
    const alertas = body.alertas ?? {};
    const horasLimiteSurtido = Number(alertas.horasLimiteSurtido ?? 24);
    const horasLimiteRecepcion = Number(alertas.horasLimiteRecepcion ?? 24);
    if (!Number.isFinite(horasLimiteSurtido) || horasLimiteSurtido < 1) {
      return badRequest("El plazo de surtido debe ser de al menos 1 hora");
    }
    if (!Number.isFinite(horasLimiteRecepcion) || horasLimiteRecepcion < 1) {
      return badRequest("El plazo de recepción debe ser de al menos 1 hora");
    }
    const destinatarios = Array.isArray(alertas.destinatarios)
      ? alertas.destinatarios.map((d: unknown) => String(d).trim()).filter(Boolean)
      : [];
    const destinatariosCompras = Array.isArray(alertas.destinatariosCompras)
      ? alertas.destinatariosCompras.map((d: unknown) => String(d).trim()).filter(Boolean)
      : [];
    update.alertas = {
      activas: alertas.activas !== false,
      horasLimiteSurtido,
      horasLimiteRecepcion,
      destinatarios,
      inventarioCeroActiva: alertas.inventarioCeroActiva !== false,
      destinatariosCompras,
    };
  }
  if ("tasaIvaFactura" in body) {
    const tasa = Number(body.tasaIvaFactura);
    if (!Number.isFinite(tasa) || tasa < 0 || tasa > 100) return badRequest("La tasa de IVA debe ir de 0 a 100");
    update.tasaIvaFactura = tasa;
  }
  // `null` borra el NIP (deja las cancelaciones sin autorización); una cadena lo
  // cambia. Si no viene la llave, el NIP actual no se toca.
  if ("nipSupervisor" in body) {
    if (body.nipSupervisor === null) {
      update.nipSupervisorHash = "";
    } else {
      const nip = String(body.nipSupervisor ?? "").trim();
      if (!NIP_SUPERVISOR_REGEX.test(nip)) return badRequest("El NIP de supervisor debe tener de 4 a 8 dígitos");
      update.nipSupervisorHash = await hashPassword(nip);
    }
  }

  // Mismo trato para el NIP con el que se autoriza CREAR supervisores, que es
  // un candado aparte del de las cancelaciones.
  if ("nipCreacionSupervisor" in body) {
    if (body.nipCreacionSupervisor === null) {
      update.nipCreacionSupervisorHash = "";
    } else {
      const nip = String(body.nipCreacionSupervisor ?? "").trim();
      if (!NIP_CREACION_SUPERVISOR_REGEX.test(nip)) {
        return badRequest("El NIP para crear supervisores debe ser de 6 dígitos");
      }
      update.nipCreacionSupervisorHash = await hashPassword(nip);
    }
  }

  await connectDB();
  const actual = await obtenerConfiguracion();
  Object.assign(actual, update);
  await actual.save();

  const { nipSupervisorHash, nipCreacionSupervisorHash, ...resto } = actual.toObject();
  return NextResponse.json({
    ...resto,
    nipSupervisorConfigurado: !!nipSupervisorHash,
    nipCreacionSupervisorConfigurado: !!nipCreacionSupervisorHash,
  });
}
