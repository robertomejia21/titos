import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession, unauthorized, forbidden, puede, badRequest } from "@/lib/apiAuth";
import { buscarSupervisorPorNip } from "@/lib/supervisores";
import { contextoPuntoVenta } from "@/lib/puntoVenta";
import { calcularResumenSesion, calcularEfectivoEsperado, calcularEfectivoEsperadoUsd } from "@/lib/caja";
import CajaSesion from "@/models/CajaSesion";
import Arqueo, { IntentoArqueo } from "@/models/Arqueo";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");
const montoValido = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e9 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-5;
class ErrorArqueo extends Error { constructor(message: string, public status = 400) { super(message); } }
const responder = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const usuario = await requireSession(req);
  if (!usuario) return unauthorized();
  if (!puede(usuario, "pos.vender")) return forbidden();
  const body = await req.json().catch(() => null);
  if (!body || !["consultar", "guardar"].includes(body.accion)) return badRequest("Acción inválida");
  try {
    await connectDB();
    const ctx = await contextoPuntoVenta(usuario);
    if (!ctx) return forbidden();
    if (body.accion === "consultar") {
      const intento = await IntentoArqueo.findOneAndUpdate({ _id: `${usuario.userId}:${Math.floor(Date.now() / 60_000)}` }, { $inc: { cantidad: 1 }, $setOnInsert: { expiraEn: new Date(Date.now() + 120_000) } }, { upsert: true, returnDocument: "after" });
      if (intento.cantidad > 10) return responder({ error: "Demasiados intentos. Espera un minuto antes de consultar otra vez." }, 429);
      const supervisor = await buscarSupervisorPorNip(typeof body.nip === "string" ? body.nip : "", ctx.sucursalId, true);
      if (!supervisor) return responder({ error: "No se pudo identificar a un supervisor autorizado. Revisa que su NIP personal sea correcto, esté activo y no esté repetido." }, 403);
      const token = randomBytes(32).toString("hex");
      const registro = await mongoose.connection.transaction(async (session) => {
        const caja = await CajaSesion.findOne({ sucursalId: ctx.sucursalId, estado: "abierta" }).session(session);
        if (!caja) throw new ErrorArqueo("No hay una caja abierta", 409);
        const resumen = await calcularResumenSesion(String(caja._id), session);
        const [arqueo] = await Arqueo.create([{
          sucursalId: ctx.sucursalId, cajaSesionId: caja._id, usuarioId: usuario.userId,
          supervisorId: supervisor.id, supervisorNombre: supervisor.nombre, tokenHash: hash(token),
          consultadoEn: new Date(), venceEn: new Date(Date.now() + 15 * 60_000), resumen,
          efectivoInicial: caja.efectivoInicial, efectivoInicialUsd: caja.efectivoInicialUsd ?? 0,
          efectivoEsperado: calcularEfectivoEsperado(caja.efectivoInicial, resumen),
          efectivoEsperadoUsd: calcularEfectivoEsperadoUsd(caja.efectivoInicialUsd ?? 0, resumen),
        }], { session });
        return arqueo.toObject();
      });
      delete registro.tokenHash;
      const recientes = await Arqueo.find({ cajaSesionId: registro.cajaSesionId, estado: "guardado" })
        .select("supervisorNombre guardadoEn efectivoContado efectivoContadoUsd diferencia diferenciaUsd notas")
        .sort({ guardadoEn: -1 }).limit(5).lean();
      return responder({ ...registro, token, recientes });
    }
    if (!mongoose.isValidObjectId(body.id) || typeof body.token !== "string" || body.token.length !== 64) return forbidden();
    if (!montoValido(body.efectivoContado) || !montoValido(body.efectivoContadoUsd)) return badRequest("Captura pesos y dólares contados, con hasta dos decimales; usa cero si no hay.");
    if (typeof body.notas !== "string" || body.notas.length > 1000) return badRequest("La nota admite hasta 1,000 caracteres");
    const resultado = await mongoose.connection.transaction(async (session) => {
      const arqueo = await Arqueo.findOne({ _id: body.id, usuarioId: usuario.userId, sucursalId: ctx.sucursalId, tokenHash: hash(body.token) }).session(session);
      if (!arqueo) throw new ErrorArqueo("Autorización inválida", 403);
      if (arqueo.estado === "guardado") return arqueo.toObject();
      if (arqueo.venceEn.getTime() < Date.now()) throw new ErrorArqueo("La autorización venció. Vuelve a consultar con el NIP.", 409);
      const caja = await CajaSesion.findOne({ _id: arqueo.cajaSesionId, estado: "abierta" }).session(session);
      if (!caja) throw new ErrorArqueo("La caja ya se cerró. Vuelve a consultar.", 409);
      const actual = await calcularResumenSesion(String(caja._id), session);
      if (JSON.stringify(actual) !== JSON.stringify(arqueo.resumen) || caja.efectivoInicial !== arqueo.efectivoInicial || (caja.efectivoInicialUsd ?? 0) !== arqueo.efectivoInicialUsd) {
        throw new ErrorArqueo("La caja tuvo movimientos durante el conteo. Vuelve a consultar con el NIP y revisa el efectivo.", 409);
      }
      arqueo.efectivoContado = body.efectivoContado;
      arqueo.efectivoContadoUsd = body.efectivoContadoUsd;
      arqueo.diferencia = Number((body.efectivoContado - arqueo.efectivoEsperado).toFixed(2));
      arqueo.diferenciaUsd = Number((body.efectivoContadoUsd - arqueo.efectivoEsperadoUsd).toFixed(2));
      arqueo.notas = body.notas.trim();
      arqueo.estado = "guardado";
      arqueo.guardadoEn = new Date();
      await arqueo.save({ session });
      return arqueo.toObject();
    });
    return responder(resultado);
  } catch (error) {
    if (error instanceof ErrorArqueo) return responder({ error: error.message }, error.status);
    console.error("No se pudo completar el arqueo", error instanceof Error ? error.message : "Error");
    return responder({ error: "No se pudo completar el arqueo. Intenta nuevamente." }, 500);
  }
}
