// Pruebas de la minuta del 28 de octubre: montos ocultos en traspasos,
// surtidor/cargador/capturista, cajas armada → cerrada → sellada, pre-carga sin
// amarrar chofer, salida a ruta, tarjeta digital del folio y faltantes por grupo.
// Corre contra un Mongo en memoria: no toca la base real.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { permisosLegado, tienePermiso } from "../src/lib/permisos";
import { impedimentosPrecarga, puedeEditarCajas } from "../src/lib/logistica";

function puras() {
  assert.ok(!permisosLegado("matriz").includes("pedidos.ver_montos"), "matriz no ve montos de fábrica");
  assert.ok(!permisosLegado("sucursal").includes("pedidos.ver_montos"), "la tienda no ve montos de fábrica");
  assert.ok(tienePermiso({ permisos: ["pedidos.ver_montos"] }, "pedidos.ver_montos"), "se puede dar a mano");

  const base = { estado: "surtido", cajas: [{ numero: "1", estado: "sellada" }, { numero: "2" }], carga: { etapa: "sin_cargar" } };
  assert.deepEqual(impedimentosPrecarga(base), [], "las cajas viejas sin estado cuentan como selladas");
  assert.deepEqual(impedimentosPrecarga({ ...base, cajas: [{ numero: "3", estado: "armada" }] }), ["Falta sellar: caja 3"]);
  assert.equal(impedimentosPrecarga({ ...base, estado: "nivelado" }).length, 1, "sin surtir no se pre-carga");
  assert.ok(puedeEditarCajas({ ...base, carga: { etapa: "cargado" } }), "en la unidad todavía se puede rearmar");
  assert.ok(!puedeEditarCajas({ ...base, carga: { etapa: "en_ruta" } }), "en ruta ya no");
  console.log("OK   reglas puras (permisos y pre-carga)");
}

async function integracion() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_logistica_pruebas");
  process.env.JWT_SECRET = "solo-pruebas-aisladas-logistica-2026";
  try {
    const { connectDB } = await import("../src/lib/db");
    const { signSession } = await import("../src/lib/auth");
    const User = (await import("../src/models/User")).default;
    const Sucursal = (await import("../src/models/Sucursal")).default;
    const Producto = (await import("../src/models/Producto")).default;
    const Pedido = (await import("../src/models/Pedido")).default;
    const Empleado = (await import("../src/models/Empleado")).default;
    const Vehiculo = (await import("../src/models/Vehiculo")).default;
    const Ruta = (await import("../src/models/Ruta")).default;
    const RolEntrega = (await import("../src/models/RolEntrega")).default;
    const { armarTarjetaFolio } = await import("../src/lib/tarjetaFolio");
    const { armarFaltantesDelDia } = await import("../src/lib/faltantesDiarios");
    const { generarPdfPedido } = await import("../src/lib/pdf");
    const pedidosApi = await import("../src/app/api/pedidos/route");
    const pedidoApi = await import("../src/app/api/pedidos/[id]/route");
    const nivelar = await import("../src/app/api/pedidos/nivelar/route");
    const surtir = await import("../src/app/api/pedidos/[id]/surtir/route");
    const cajasApi = await import("../src/app/api/pedidos/[id]/cajas/route");
    const cajaApi = await import("../src/app/api/pedidos/[id]/cajas/[numero]/route");
    const cargaApi = await import("../src/app/api/pedidos/[id]/carga/route");
    const sugerir = await import("../src/app/api/operacion/rol/sugerir/route");
    const rolApi = await import("../src/app/api/operacion/rol/route");
    const configApi = await import("../src/app/api/operacion/config/route");

    await connectDB();
    await Sucursal.create({ nombre: "Cedis", esMatriz: true });
    const alcala = await Sucursal.create({ nombre: "Sucursal Alcalá" });
    const admin = await User.create({ nombre: "Coordinador", email: "coord@titos.local", passwordHash: "x", role: "matriz" });
    const tienda = await User.create({ nombre: "Gerente Alcalá", email: "alcala@titos.local", passwordHash: "x", role: "sucursal", sucursalId: alcala._id });
    const tokenMatriz = await signSession({ userId: String(admin._id), email: admin.email, nombre: admin.nombre, role: "matriz", sucursalId: null });
    const tokenTienda = await signSession({ userId: String(tienda._id), email: tienda.email, nombre: tienda.nombre, role: "sucursal", sucursalId: String(alcala._id) });
    const llamarCon =
      (token: string) =>
      (mod: Record<string, unknown>, metodo: string, url: string, body?: unknown, params?: Record<string, string>) =>
        (mod[metodo] as (req: NextRequest, ctx?: unknown) => Promise<Response>)(
          new NextRequest(`http://localhost${url}`, { method: metodo, headers: { cookie: `titos_session=${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
          params ? { params: Promise.resolve(params) } : undefined
        );
    const llamar = llamarCon(tokenMatriz);
    const comoTienda = llamarCon(tokenTienda);

    const fabuloso = await Producto.create({ sku: "FAB", nombre: "Fabuloso 1L", categoria: "Abarrotes", unidad: "pieza", existenciaMatriz: 50, precioVenta: 32, stockMinimo: 60 });
    const tomate = await Producto.create({ sku: "TOM", nombre: "Tomate saladette", categoria: "Frutas y verduras", unidad: "pieza", existenciaMatriz: 2, precioVenta: 10, stockMinimo: 20 });
    const [surtidor, cargador, chofer, otroChofer] = await Empleado.create([
      { nombre: "Pedro Surtidor", puesto: "Surtidor", whatsapp: "0" },
      { nombre: "Raúl Cargador", puesto: "Cargador", whatsapp: "0" },
      { nombre: "Luis", puesto: "Chofer", whatsapp: "0" },
      { nombre: "Ana", puesto: "Chofer", whatsapp: "0" },
    ]);
    const forte = await Vehiculo.create({ nombre: "Forte", tipo: "camion" });
    await Ruta.create({ nombre: "Ruta Alcalá", tipo: "primera_vuelta", horaSalida: "07:00", vehiculoPreferidoId: forte._id, choferResponsableId: chofer._id, paradas: [{ tipo: "sucursal", sucursalId: alcala._id }] });

    // ---- La tienda captura: queda el capturista ----
    const creado = await comoTienda(pedidosApi, "POST", "/api/pedidos", { items: [{ productoId: String(fabuloso._id), cantidad: 12 }] });
    assert.equal(creado.status, 201);
    const { pedido: nuevo } = await creado.json();
    const id = String(nuevo._id);
    const p = { id };
    assert.equal(nuevo.capturadoPorNombre, "Gerente Alcalá");
    assert.equal(nuevo.historial[0].tipo, "capturado");

    // ---- Montos ocultos por default; se prenden por configuración ----
    const lista = async () => (await (await llamar(pedidosApi, "GET", "/api/pedidos")).json())[0];
    assert.equal((await lista()).items[0].precioVenta, null, "matriz no ve precios de fábrica");
    assert.equal((await (await comoTienda(pedidoApi, "GET", `/api/pedidos/${id}`, undefined, p)).json()).items[0].precioVenta, null, "la tienda tampoco");
    assert.equal((await llamar(configApi, "PATCH", "/api/operacion/config", { traspasos: { mostrarMontos: true } })).status, 200);
    assert.equal((await lista()).items[0].precioVenta, 32, "con la configuración prendida sí");
    await llamar(configApi, "PATCH", "/api/operacion/config", { traspasos: { mostrarMontos: false } });

    // ---- Nivelar, surtidor y surtido ----
    assert.equal((await llamar(nivelar, "POST", "/api/pedidos/nivelar", {})).status, 200);
    const conSurtidor = await (await llamar(pedidoApi, "PATCH", `/api/pedidos/${id}`, { surtidorId: String(surtidor._id) }, p)).json();
    assert.equal(conSurtidor.surtidorId.nombre, "Pedro Surtidor");
    assert.equal(conSurtidor.repartidorId, null, "asignar surtidor no toca al chofer");
    const surtido = await llamar(surtir, "POST", `/api/pedidos/${id}/surtir`, { items: [{ productoId: String(fabuloso._id), cantidadSurtida: 12 }] }, p);
    assert.equal(surtido.status, 200);
    const surtidoJson = await surtido.json();
    assert.equal(surtidoJson.pedido.estado, "surtido");
    assert.equal(surtidoJson.pedido.sucursalId.nombre, "Sucursal Alcalá", "el surtido regresa el pedido poblado");
    assert.equal(surtidoJson.pedido.items[0].precioVenta, null, "y sin montos");

    // ---- Caja armada → no se puede pre-cargar ----
    const caja = (body: unknown) => llamar(cajasApi, "POST", `/api/pedidos/${id}/cajas`, body, p);
    assert.equal((await caja({ numero: "1", cincho1: "A1", items: [{ productoId: String(fabuloso._id), nombreProducto: "Fabuloso 1L", cantidad: 12 }] })).status, 400, "un solo cincho no sella");
    const armada = await (await caja({ numero: "1", categoria: "Abarrotes", items: [{ productoId: String(fabuloso._id), nombreProducto: "Fabuloso 1L", cantidad: 12 }] })).json();
    assert.equal(armada.cajas[0].estado, "armada");

    const hoy = "2026-11-04";
    const rol = await (await llamar(sugerir, "POST", "/api/operacion/rol/sugerir", { fecha: hoy })).json();
    const salida = rol.salidas[0];
    assert.deepEqual(salida.pedidos.map((x: { folio: string }) => x.folio), [nuevo.folio]);
    const precargar = () => llamar(cargaApi, "POST", `/api/pedidos/${id}/carga`, { accion: "precargar", fecha: hoy, salidaId: salida._id }, p);
    const sinSello = await precargar();
    assert.equal(sinSello.status, 400);
    assert.ok((await sinSello.json()).error.includes("Falta sellar: caja 1"));

    const accionCaja = (body: unknown) => llamar(cajaApi, "PATCH", `/api/pedidos/${id}/cajas/1`, body, { id, numero: "1" });
    assert.equal((await accionCaja({ accion: "cerrar" })).status, 200);
    assert.equal((await accionCaja({ accion: "sellar", cincho1: "A1" })).status, 400, "sellar pide los dos cinchos");
    assert.equal((await (await accionCaja({ accion: "sellar", cincho1: "A1", cincho2: "A2" })).json()).cajas[0].estado, "sellada");

    // ---- Pre-carga sin chofer ----
    const pre = await precargar();
    assert.equal(pre.status, 200);
    const precargado = await pre.json();
    assert.equal(precargado.carga.etapa, "precargado");
    assert.equal(precargado.repartidorId, null, "pre-cargar no amarra al chofer");

    // Cambio de último momento: reabrir la caja no saca al folio de la unidad.
    const reabierta = await (await accionCaja({ accion: "reabrir", motivo: "Cambio de prioridad: entra tomate" })).json();
    assert.equal(reabierta.carga.etapa, "precargado");
    assert.equal(reabierta.cajas[0].cincho1, "", "al reabrir se rompen los cinchos");
    const evento = (await Pedido.findById(id).lean())!.historial.find((e: { tipo: string }) => e.tipo === "caja_reabierta");
    assert.ok(evento.detalle.includes("A1 / A2") && evento.detalle.includes("último momento"), "queda constancia de los cinchos rotos");
    assert.equal((await llamar(cargaApi, "POST", `/api/pedidos/${id}/carga`, { accion: "cargado" }, p)).status, 400, "con la caja abierta no se confirma la carga");

    // La salida no arranca con cajas abiertas ni sin chofer.
    const rolVista = await (await llamar(rolApi, "GET", `/api/operacion/rol?fecha=${hoy}`)).json();
    const conEstado = (cambios: Record<string, unknown>) =>
      rolVista.salidas.map((s: Record<string, unknown>) => ({ ...s, pedidoIds: (s.pedidos as { _id: string }[]).map((x) => x._id), ...cambios }));
    const abierta = await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: hoy, salidas: conEstado({ estado: "en_ruta" }) });
    assert.equal(abierta.status, 400);
    assert.ok((await abierta.json()).error.includes("falta sellar caja 1"));
    await accionCaja({ accion: "sellar", cincho1: "B1", cincho2: "B2" });

    // ---- Vehículo cargado ----
    const cargado = await (await llamar(cargaApi, "POST", `/api/pedidos/${id}/carga`, { accion: "cargado", cargadorId: String(cargador._id) }, p)).json();
    assert.equal(cargado.carga.etapa, "cargado");
    assert.equal(cargado.cargadorId.nombre, "Raúl Cargador");

    // El chofer programado cambia sin tocar la carga.
    const cambioChofer = await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: hoy, salidas: conEstado({ choferId: String(otroChofer._id) }) });
    assert.equal(cambioChofer.status, 200);
    const tras = (await Pedido.findById(id).lean())!;
    assert.equal(tras.carga.etapa, "cargado", "cambiar de chofer no baja la carga");
    assert.equal(tras.repartidorId, null);

    assert.equal((await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: hoy, salidas: conEstado({ estado: "en_ruta", choferId: null }) })).status, 400, "sin chofer no arranca");

    // ---- Sale a ruta: ahora sí se amarra el chofer ----
    assert.equal((await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: hoy, salidas: conEstado({ estado: "en_ruta", choferId: String(otroChofer._id) }) })).status, 200);
    const enRuta = (await Pedido.findById(id).lean())!;
    assert.equal(enRuta.carga.etapa, "en_ruta");
    assert.equal(String(enRuta.repartidorId), String(otroChofer._id), "el chofer queda amarrado al salir");
    assert.ok(enRuta.carga.salioEn);
    assert.equal((await accionCaja({ accion: "reabrir" })).status, 400, "en ruta ya no se mueven cajas");
    void chofer;

    // ---- Tarjeta digital ----
    const tarjeta = (await armarTarjetaFolio(id, false))!;
    const quien = (rol: string) => tarjeta.responsables.find((r) => r.rol === rol)!.nombre;
    assert.equal(quien("Capturó"), "Gerente Alcalá");
    assert.equal(quien("Surtidor"), "Pedro Surtidor");
    assert.equal(quien("Cargó"), "Raúl Cargador");
    assert.equal(quien("Chofer"), "Ana");
    assert.equal(tarjeta.salida?.vehiculo, "Forte");
    assert.equal(tarjeta.salida?.horaSalida, "07:00");
    assert.equal(tarjeta.cajas[0].cinchos, "B1 / B2");
    assert.equal(tarjeta.items[0].subtotal, null, "la tarjeta respeta los montos ocultos");
    const tipos = tarjeta.historial.map((e) => e.tipo);
    for (const t of ["capturado", "nivelado", "surtidor", "surtido", "caja_armada", "caja_sellada", "precargado", "caja_reabierta", "cargado", "en_ruta"]) assert.ok(tipos.includes(t), `historial con ${t}`);
    assert.equal((await RolEntrega.findOne({ fecha: hoy }).lean())!.salidas[0].estado, "en_ruta");

    // ---- PDF sin montos ----
    const pdf = await generarPdfPedido({ folio: "X", corte: "c", estado: "surtido", sucursalNombre: "Alcalá", items: enRuta.items, cajas: enRuta.cajas, verMontos: false });
    assert.ok(pdf.length > 1000, "el PDF sin montos se genera");

    // ---- Faltantes por grupo ----
    assert.equal(
      (await llamar(configApi, "PATCH", "/api/operacion/config", { faltantesDiarios: { segmentos: [{ nombre: "Frutas", categorias: ["frutas y verduras"], destinatarios: ["6860000000"] }] } })).status,
      200
    );
    assert.equal((await llamar(configApi, "PATCH", "/api/operacion/config", { faltantesDiarios: { segmentos: [{ nombre: "Vacío", categorias: [] }] } })).status, 400, "un grupo necesita categorías");
    const faltantes = await armarFaltantesDelDia();
    const frutas = faltantes.segmentos[0];
    assert.ok(frutas.mensaje.includes("Tomate saladette") && !frutas.mensaje.includes("Fabuloso"), "a Alonso solo le llega fruta y verdura");
    assert.ok(faltantes.resumenGeneral.includes("Fabuloso") && !faltantes.resumenGeneral.includes("Tomate"), "a Compras le llega lo demás");
    assert.ok(faltantes.resumenInterno.includes("Fabuloso") && faltantes.resumenInterno.includes("Tomate"), "la lista completa sigue disponible");

    console.log("OK   integración (captura → montos → surtido → cajas → pre-carga → rearmado → carga → ruta → tarjeta → faltantes)");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

puras();
integracion().catch((error) => {
  console.error(error);
  process.exit(1);
});
