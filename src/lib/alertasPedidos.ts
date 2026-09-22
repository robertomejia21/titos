import Pedido from "@/models/Pedido";
import Sucursal from "@/models/Sucursal";
import { obtenerConfiguracion } from "@/lib/configuracion";
import { sendMessage as enviarWhatsApp } from "@/lib/greenApi";

// Barrido de pedidos que se quedaron atorados: los que matriz no surtió dentro
// del plazo y los que la sucursal no confirmó haber recibido. Manda un WhatsApp
// y marca el pedido para no volver a avisar de lo mismo en el siguiente barrido.
//
// El aviso se manda CONSOLIDADO (un mensaje con todos los pedidos atrasados del
// destinatario) en vez de uno por pedido: un día con quince pedidos atorados
// mandaría quince mensajes y nadie los leería.

const MS_POR_HORA = 60 * 60 * 1000;

/** Tope de pedidos por barrido, para que un rezago viejo no sature el envío. */
const LIMITE_POR_BARRIDO = 100;

export type TipoAlertaPedido = "surtido_atrasado" | "recepcion_atrasada";

export type ResultadoAlertas = {
  ejecutado: boolean;
  motivo?: string;
  surtidoAtrasado: number;
  recepcionAtrasada: number;
  mensajesEnviados: number;
  mensajesFallidos: number;
};

type PedidoAtrasado = {
  _id: unknown;
  folio: string;
  sucursalId: unknown;
  horasAtraso: number;
};

function horasEntre(desde: Date, hasta: Date) {
  return Math.floor((hasta.getTime() - desde.getTime()) / MS_POR_HORA);
}

function renglon(p: PedidoAtrasado) {
  return `• ${p.folio} — ${p.horasAtraso} h de atraso`;
}

/**
 * Deja constancia del aviso en el pedido.
 *
 * Solo un aviso **enviado** frena los siguientes barridos: si se marcara también
 * el fallido, una caída de Evolution API o un WhatsApp que todavía no está
 * capturado se tragarían la alerta para siempre. Así se reintenta en el siguiente
 * barrido y se
 * arregla solo en cuanto el envío vuelva a funcionar.
 *
 * De los fallos se guarda solo el primero (`alertas.tipo` no repetido), para que
 * un pedido olvidado con el servicio caído no acumule un renglón por barrido.
 */
async function marcarAlerta(
  ids: unknown[],
  tipo: TipoAlertaPedido,
  estado: "enviada" | "fallida" | "sin_whatsapp",
  error: string,
  horasPorPedido: Map<string, number>
) {
  await Promise.all(
    ids.map((id) => {
      const registro = {
        tipo,
        estado,
        error,
        enviadaEn: new Date(),
        horasAtraso: horasPorPedido.get(String(id)) ?? 0,
      };
      const filtro =
        estado === "enviada" ? { _id: id } : { _id: id, "alertas.tipo": { $ne: tipo } };
      return Pedido.updateOne(filtro, { $push: { alertas: registro } });
    })
  );
}

/** Un pedido deja de avisarse cuando YA se mandó el aviso, no cuando se intentó. */
function sinAvisoEnviado(tipo: TipoAlertaPedido) {
  return { alertas: { $not: { $elemMatch: { tipo, estado: "enviada" } } } };
}

export async function revisarPedidosAtrasados(ahora = new Date()): Promise<ResultadoAlertas> {
  const resultado: ResultadoAlertas = {
    ejecutado: true,
    surtidoAtrasado: 0,
    recepcionAtrasada: 0,
    mensajesEnviados: 0,
    mensajesFallidos: 0,
  };

  const config = await obtenerConfiguracion();
  const alertas = config.alertas;

  if (alertas?.activas === false) {
    return { ...resultado, ejecutado: false, motivo: "Las alertas automáticas están desactivadas" };
  }

  const horasSurtido = alertas?.horasLimiteSurtido ?? 24;
  const horasRecepcion = alertas?.horasLimiteRecepcion ?? 24;
  const destinatarios = (alertas?.destinatarios ?? []).filter((d: string) => d.trim());

  // ---------- 1. Pedidos que matriz no ha surtido ----------
  const limiteSurtido = new Date(ahora.getTime() - horasSurtido * MS_POR_HORA);

  const sinSurtir = await Pedido.find({
    estado: { $in: ["pendiente", "nivelado"] },
    fecha: { $lte: limiteSurtido },
    ...sinAvisoEnviado("surtido_atrasado"),
  })
    .select("folio fecha sucursalId")
    .sort({ fecha: 1 })
    .limit(LIMITE_POR_BARRIDO)
    .lean();

  resultado.surtidoAtrasado = sinSurtir.length;

  if (sinSurtir.length > 0) {
    const sucursales = await Sucursal.find({ _id: { $in: sinSurtir.map((p) => p.sucursalId) } })
      .select("nombre")
      .lean();
    const nombrePorSucursal = new Map(sucursales.map((s) => [String(s._id), s.nombre]));

    const atrasados: PedidoAtrasado[] = sinSurtir.map((p) => ({
      _id: p._id,
      folio: p.folio,
      sucursalId: p.sucursalId,
      horasAtraso: horasEntre(p.fecha, ahora),
    }));
    const horasPorPedido = new Map(atrasados.map((p) => [String(p._id), p.horasAtraso]));
    const ids = atrasados.map((p) => p._id);

    const mensaje = [
      `Pedidos sin surtir (más de ${horasSurtido} h)`,
      "",
      ...atrasados.map(
        (p) => `${renglon(p)} — ${nombrePorSucursal.get(String(p.sucursalId)) ?? "Sucursal"}`
      ),
      "",
      "Entra a Pedidos de sucursales para procesarlos.",
    ].join("\n");

    if (destinatarios.length === 0) {
      await marcarAlerta(ids, "surtido_atrasado", "sin_whatsapp", "No hay destinatarios configurados", horasPorPedido);
    } else {
      // Se intenta con todos los destinatarios y hasta el final se sella UNA
      // sola marca por pedido: sellar dentro del bucle dejaría dos registros
      // cuando un número recibe y otro falla.
      let algunoLlego = false;
      const errores: string[] = [];

      for (const numero of destinatarios) {
        try {
          await enviarWhatsApp(numero, mensaje);
          algunoLlego = true;
          resultado.mensajesEnviados++;
        } catch (err) {
          errores.push((err as Error).message);
          resultado.mensajesFallidos++;
        }
      }

      // Si no llegó a nadie queda registrado el error, pero el pedido NO se da
      // por avisado: el siguiente barrido lo vuelve a intentar.
      await marcarAlerta(
        ids,
        "surtido_atrasado",
        algunoLlego ? "enviada" : "fallida",
        algunoLlego ? "" : errores.join(" · "),
        horasPorPedido
      );
    }
  }

  // ---------- 2. Pedidos surtidos que la sucursal no ha confirmado ----------
  const limiteRecepcion = new Date(ahora.getTime() - horasRecepcion * MS_POR_HORA);

  const sinRecibir = await Pedido.find({
    estado: "surtido",
    // Los pedidos surtidos antes de que existiera este campo no traen fecha; se
    // dejan fuera a propósito en vez de inventarles una antigüedad.
    surtidoEn: { $ne: null, $lte: limiteRecepcion },
    ...sinAvisoEnviado("recepcion_atrasada"),
  })
    .select("folio surtidoEn sucursalId")
    .sort({ surtidoEn: 1 })
    .limit(LIMITE_POR_BARRIDO)
    .lean();

  resultado.recepcionAtrasada = sinRecibir.length;

  if (sinRecibir.length > 0) {
    const sucursales = await Sucursal.find({ _id: { $in: sinRecibir.map((p) => p.sucursalId) } })
      .select("nombre whatsapp")
      .lean();
    const porSucursal = new Map(sucursales.map((s) => [String(s._id), s]));

    // Un mensaje por sucursal con todos sus pedidos pendientes de confirmar.
    const agrupados = new Map<string, PedidoAtrasado[]>();
    for (const p of sinRecibir) {
      const clave = String(p.sucursalId);
      const lista = agrupados.get(clave) ?? [];
      lista.push({
        _id: p._id,
        folio: p.folio,
        sucursalId: p.sucursalId,
        horasAtraso: horasEntre(p.surtidoEn as Date, ahora),
      });
      agrupados.set(clave, lista);
    }

    for (const [sucursalId, pedidos] of agrupados) {
      const sucursal = porSucursal.get(sucursalId);
      const ids = pedidos.map((p) => p._id);
      const horasPorPedido = new Map(pedidos.map((p) => [String(p._id), p.horasAtraso]));

      if (!sucursal?.whatsapp) {
        await marcarAlerta(
          ids,
          "recepcion_atrasada",
          "sin_whatsapp",
          "La sucursal no tiene WhatsApp configurado",
          horasPorPedido
        );
        continue;
      }

      const mensaje = [
        `Mercancía por confirmar en ${sucursal.nombre}`,
        "",
        `Matriz surtió estos pedidos hace más de ${horasRecepcion} h y todavía no registras la recepción:`,
        ...pedidos.map(renglon),
        "",
        "Entra a Pedidos y captura lo que recibiste.",
      ].join("\n");

      try {
        await enviarWhatsApp(sucursal.whatsapp, mensaje);
        resultado.mensajesEnviados++;
        await marcarAlerta(ids, "recepcion_atrasada", "enviada", "", horasPorPedido);
      } catch (err) {
        resultado.mensajesFallidos++;
        await marcarAlerta(ids, "recepcion_atrasada", "fallida", (err as Error).message, horasPorPedido);
      }
    }
  }

  return resultado;
}
