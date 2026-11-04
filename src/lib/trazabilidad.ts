import { randomBytes } from "node:crypto";
import Pedido from "@/models/Pedido";
import Sucursal from "@/models/Sucursal";
import Incidencia from "@/models/Incidencia";
import EventoRuta from "@/models/EventoRuta";
import { salidaDelFolio } from "@/lib/tarjetaFolio";
import { estadoCaja, etapaDe, evento, PUNTO_ESCANEO_LABEL, type PuntoEscaneo, type TipoEventoRuta } from "@/lib/logistica";
import type { SessionPayload } from "@/lib/auth";

// Trazabilidad por QR (minuta del 28 de octubre): cada caja trae su QR, que se
// lee con la tablet al subir a la unidad, al acomodar por chofer y al llegar a
// la tienda. Si la caja llega a la tienda equivocada se abre una incidencia y
// la tienda ve a dónde iba.

export function nuevoQr() {
  return randomBytes(9).toString("base64url");
}

/** Pone QR a las cajas (y al folio) que todavía no tienen; true si cambió algo. */
export function asegurarQrs(pedido: { qrToken?: string | null; cajas: { qr?: string | null }[] }) {
  let cambio = false;
  if (!pedido.qrToken) {
    pedido.qrToken = nuevoQr();
    cambio = true;
  }
  for (const c of pedido.cajas) {
    if (!c.qr) {
      c.qr = nuevoQr();
      cambio = true;
    }
  }
  return cambio;
}

/** Acepta la llave sola o la dirección completa que trae el QR (…/q/<llave>). */
export function llaveDeCodigo(codigo: unknown) {
  const texto = String(codigo ?? "").trim();
  const llave = texto.includes("/q/") ? texto.slice(texto.lastIndexOf("/q/") + 3).split(/[?#/]/)[0] : texto;
  return /^[A-Za-z0-9_-]{6,40}$/.test(llave) ? llave : null;
}

export async function registrarEventoRuta(datos: {
  fecha: string;
  salidaId?: unknown;
  salidaNombre?: string;
  tipo: TipoEventoRuta;
  detalle?: string;
  folio?: string;
  pedidoId?: unknown;
  sucursalId?: unknown;
  porNombre?: string;
}) {
  return EventoRuta.create({ ...datos, detalle: (datos.detalle ?? "").slice(0, 500) });
}

export type ResultadoEscaneo = {
  ok: boolean;
  /** Aviso para quien escanea (caja de otra tienda, sin sellar, sin pre-carga). */
  alerta: string | null;
  mensaje: string;
  pedidoId: string;
  folio: string;
  sucursalDestino: string;
  caja: string | null;
  contenido: string;
  salida: string | null;
  avance: { escaneadas: number; total: number };
  incidenciaId: string | null;
};

type CajaDoc = { numero: string; qr?: string | null; estado?: string | null; items: { nombreProducto: string; cantidad: number }[]; escaneos: { punto: string; resultado?: string }[] };

/**
 * Registra la lectura de un QR. Carga y acomodo los hace el CEDIS; recepción,
 * la tienda. Regresa `null` si el código no es de ningún folio.
 */
export async function registrarEscaneo(session: SessionPayload, codigo: unknown, punto: PuntoEscaneo): Promise<ResultadoEscaneo | null> {
  const llave = llaveDeCodigo(codigo);
  if (!llave) return null;
  const pedido = await Pedido.findOne({ $or: [{ qrToken: llave }, { "cajas.qr": llave }] });
  if (!pedido) return null;

  const caja = (pedido.cajas as CajaDoc[]).find((c) => c.qr === llave) ?? null;
  const [destino, enSalida] = await Promise.all([Sucursal.findById(pedido.sucursalId).select("nombre").lean(), salidaDelFolio(String(pedido._id), pedido.carga)]);
  const sucursalDestino = (destino?.nombre as string | undefined) ?? "Sucursal";
  const etiqueta = caja ? `caja ${caja.numero}` : "folio sin cajas";

  let alerta: string | null = null;
  let resultado = "ok";
  let incidenciaId: string | null = null;

  if (punto === "recepcion") {
    if (String(pedido.sucursalId) !== session.sucursalId) {
      resultado = "sucursal_incorrecta";
      const aqui = await Sucursal.findById(session.sucursalId).select("nombre").lean();
      alerta = `Esta ${etiqueta} es de ${sucursalDestino}. No la recibas: apártala y avisa al CEDIS.`;
      // Una sola incidencia abierta por caja y tienda, aunque la escaneen varias veces.
      const existente = await Incidencia.findOne({ pedidoId: pedido._id, cajaNumero: caja?.numero ?? "", sucursalDetectoId: session.sucursalId, tipo: "sucursal_incorrecta", estado: "abierta" });
      const incidencia =
        existente ??
        (await Incidencia.create({
          tipo: "sucursal_incorrecta",
          pedidoId: pedido._id,
          folio: pedido.folio,
          cajaNumero: caja?.numero ?? "",
          sucursalDestinoId: pedido.sucursalId,
          sucursalDetectoId: session.sucursalId,
          fechaRuta: enSalida?.fecha ?? null,
          salidaId: enSalida?.salida._id ?? null,
          creadaPorNombre: session.nombre ?? "",
          comentarios: [{ porNombre: session.nombre ?? "", sucursalId: session.sucursalId, texto: `Llegó a ${aqui?.nombre ?? "otra tienda"} por error. Iba a ${sucursalDestino}.` }],
        }));
      incidenciaId = String(incidencia._id);
      if (!existente) {
        pedido.historial.push(evento(session, "incidencia", `${etiqueta} llegó a ${aqui?.nombre ?? "otra tienda"}; iba a ${sucursalDestino}`));
        if (enSalida) await registrarEventoRuta({ fecha: enSalida.fecha, salidaId: enSalida.salida._id, salidaNombre: enSalida.salida.nombre, tipo: "incidencia", detalle: `${pedido.folio} ${etiqueta} llegó a ${aqui?.nombre ?? "otra tienda"}`, folio: pedido.folio, pedidoId: pedido._id, sucursalId: session.sucursalId, porNombre: session.nombre ?? "" });
      }
    } else if (pedido.estado === "recibido") {
      alerta = "Este folio ya se recibió.";
    }
  } else {
    if (pedido.estado !== "surtido" && pedido.estado !== "recibido") alerta = "Este folio todavía no está surtido.";
    else if (caja && estadoCaja(caja) !== "sellada") alerta = `La caja ${caja.numero} no está sellada.`;
    else if (punto === "carga" && etapaDe(pedido) === "sin_cargar") alerta = "El folio no está pre-cargado en ninguna salida.";
  }

  const lista = caja ? caja.escaneos : (pedido.escaneos as CajaDoc["escaneos"]);
  const primera = !lista.some((e) => e.punto === punto && (e.resultado ?? "ok") === "ok");
  lista.push({ punto, en: new Date(), porNombre: session.nombre ?? "", sucursalId: session.sucursalId ?? null, resultado } as never);
  if (primera && resultado === "ok") {
    pedido.historial.push(evento(session, "escaneo", `${PUNTO_ESCANEO_LABEL[punto]} · ${etiqueta}`));
    if (enSalida) await registrarEventoRuta({ fecha: enSalida.fecha, salidaId: enSalida.salida._id, salidaNombre: enSalida.salida.nombre, tipo: "escaneo", detalle: `${PUNTO_ESCANEO_LABEL[punto]} · ${pedido.folio} ${etiqueta}`, folio: pedido.folio, pedidoId: pedido._id, sucursalId: session.sucursalId ?? null, porNombre: session.nombre ?? "" });
  }
  await pedido.save();

  const cajas = pedido.cajas as CajaDoc[];
  const leida = (escaneos: CajaDoc["escaneos"]) => escaneos.some((e) => e.punto === punto && (e.resultado ?? "ok") === "ok");
  const avance = cajas.length ? { escaneadas: cajas.filter((c) => leida(c.escaneos)).length, total: cajas.length } : { escaneadas: leida(pedido.escaneos) ? 1 : 0, total: 1 };

  return {
    ok: resultado === "ok",
    alerta,
    mensaje: resultado === "ok" ? `${PUNTO_ESCANEO_LABEL[punto]}: ${pedido.folio} · ${etiqueta}` : "Caja de otra sucursal",
    pedidoId: String(pedido._id),
    folio: pedido.folio,
    sucursalDestino,
    caja: caja?.numero ?? null,
    contenido: caja ? caja.items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", ") : `${pedido.items.length} producto(s) sin caja`,
    salida: enSalida ? `${enSalida.salida.nombre} · ${enSalida.fecha} ${enSalida.salida.horaSalida}` : null,
    avance,
    incidenciaId,
  };
}
