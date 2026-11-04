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
    await Producto.create({ sku: "TOM", nombre: "Tomate saladette", categoria: "Frutas y verduras", unidad: "pieza", existenciaMatriz: 2, precioVenta: 10, stockMinimo: 20 });
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

    // ================= Fase 3: QR, incidencias y bitácora de rutas =================
    const escaneosApi = await import("../src/app/api/escaneos/route");
    const incidenciasApi = await import("../src/app/api/incidencias/route");
    const incidenciaApi = await import("../src/app/api/incidencias/[id]/route");
    const bitacoraApi = await import("../src/app/api/operacion/bitacora-rutas/route");
    const { llaveDeCodigo } = await import("../src/lib/trazabilidad");
    const Incidencia = (await import("../src/models/Incidencia")).default;
    const progreso = await Sucursal.create({ nombre: "Sucursal Progreso" });
    const userProgreso = await User.create({ nombre: "Gerente Progreso", email: "progreso@titos.local", passwordHash: "x", role: "sucursal", sucursalId: progreso._id });
    const comoProgreso = llamarCon(await signSession({ userId: String(userProgreso._id), email: userProgreso.email, nombre: userProgreso.nombre, role: "sucursal", sucursalId: String(progreso._id) }));

    const qrCaja = (await Pedido.findById(id).lean())!.cajas[0].qr as string;
    assert.ok(qrCaja && qrCaja.length >= 10, "la caja armada trae su QR");
    assert.equal(llaveDeCodigo(`https://titos.da-vinci.ai/q/${qrCaja}?x=1`), qrCaja, "se acepta la dirección completa del QR");
    const escanear = (quien: typeof llamar, codigo: string, punto: string) => quien(escaneosApi, "POST", "/api/escaneos", { codigo, punto });

    assert.equal((await escanear(llamar, "nada-que-ver", "carga")).status, 404);
    assert.equal((await escanear(llamar, qrCaja, "recepcion")).status, 400, "el CEDIS no escanea recepción");
    assert.equal((await escanear(comoTienda, qrCaja, "carga")).status, 400, "la tienda no escanea carga");
    const carga = await (await escanear(llamar, qrCaja, "carga")).json();
    assert.equal(carga.ok, true);
    assert.equal(carga.alerta, null);
    assert.deepEqual(carga.avance, { escaneadas: 1, total: 1 });
    assert.equal(carga.sucursalDestino, "Sucursal Alcalá");

    // Llega a Progreso por error: aviso e incidencia, una sola aunque la escaneen dos veces.
    const equivocada = await (await escanear(comoProgreso, qrCaja, "recepcion")).json();
    assert.equal(equivocada.ok, false);
    assert.ok(equivocada.alerta.includes("Sucursal Alcalá"), "la tienda ve a dónde iba la caja");
    await escanear(comoProgreso, `/q/${qrCaja}`, "recepcion");
    assert.equal(await Incidencia.countDocuments({ tipo: "sucursal_incorrecta" }), 1);
    const correcta = await (await escanear(comoTienda, qrCaja, "recepcion")).json();
    assert.equal(correcta.ok, true);

    const deProgreso = await (await comoProgreso(incidenciasApi, "GET", "/api/incidencias")).json();
    assert.equal(deProgreso.length, 1, "Progreso ve la incidencia que detectó");
    assert.equal((await (await comoTienda(incidenciasApi, "GET", "/api/incidencias")).json()).length, 1, "Alcalá ve la de su folio");
    const incId = deProgreso[0]._id;
    const ip = { id: incId };
    assert.equal((await comoProgreso(incidenciaApi, "PATCH", `/api/incidencias/${incId}`, { comentario: "La apartamos en bodega" }, ip)).status, 200);
    assert.equal((await comoProgreso(incidenciaApi, "PATCH", `/api/incidencias/${incId}`, { comentario: "x", resolver: true }, ip)).status, 403, "solo el CEDIS resuelve");
    assert.equal((await llamar(incidenciaApi, "PATCH", `/api/incidencias/${incId}`, { resolver: true }, ip)).status, 400, "resolver pide decir cómo");
    const resuelta = await (await llamar(incidenciaApi, "PATCH", `/api/incidencias/${incId}`, { resolver: true, comentario: "Reenvío a Alcalá en la segunda vuelta" }, ip)).json();
    assert.equal(resuelta.estado, "resuelta");
    assert.equal(resuelta.comentarios.length, 3, "los comentarios se conservan");
    assert.equal((await comoProgreso(incidenciasApi, "POST", "/api/incidencias", { tipo: "caja_danada", folio: nuevo.folio, comentario: "x" })).status, 400, "una tienda no abre incidencias de folios ajenos");
    assert.equal((await comoTienda(incidenciasApi, "POST", "/api/incidencias", { tipo: "caja_danada", folio: nuevo.folio, cajaNumero: "1", comentario: "Llegó abierta" })).status, 201);

    // Bitácora: la salida y los escaneos se registraron solos; la parada extra y el folio devuelto, a mano.
    const salidaId = rolVista.salidas[0]._id;
    assert.equal((await llamar(bitacoraApi, "POST", "/api/operacion/bitacora-rutas", { fecha: hoy, salidaId, tipo: "salida", detalle: "x" })).status, 400, "la salida la registra el sistema");
    assert.equal((await llamar(bitacoraApi, "POST", "/api/operacion/bitacora-rutas", { fecha: hoy, salidaId, tipo: "parada_extra", detalle: "Gasolinera 15 min" })).status, 201);
    assert.equal((await llamar(bitacoraApi, "POST", "/api/operacion/bitacora-rutas", { fecha: hoy, salidaId, tipo: "folio_devuelto", folio: nuevo.folio, detalle: "Tienda cerrada" })).status, 201);
    assert.equal(await Incidencia.countDocuments({ tipo: "folio_devuelto" }), 1, "el folio devuelto abre incidencia");
    const bitacora = await (await llamar(bitacoraApi, "GET", `/api/operacion/bitacora-rutas?fecha=${hoy}`)).json();
    const tiposRuta = bitacora.map((e: { tipo: string }) => e.tipo);
    for (const t of ["salida", "escaneo", "incidencia", "parada_extra", "folio_devuelto"]) assert.ok(tiposRuta.includes(t), `bitácora con ${t}`);
    assert.equal((await llamar(bitacoraApi, "GET", "/api/operacion/bitacora-rutas?desde=2026-01-01&hasta=2026-03-01")).status, 400, "máximo 31 días");

    const conQr = (await armarTarjetaFolio(id, false))!;
    assert.deepEqual(conQr.cajas[0].escaneos.filter((e) => e.resultado === "ok").map((e) => e.punto), ["carga", "recepcion"]);
    assert.equal(conQr.incidencias.length, 3);
    const rolConAvance = await (await llamar(rolApi, "GET", `/api/operacion/rol?fecha=${hoy}`)).json();
    assert.equal(rolConAvance.salidas[0].pedidos[0].bultosEnCarga, 1, "la pantalla ve las cajas escaneadas en carga");

    console.log("OK   fase 3 (QR → carga → sucursal equivocada → incidencia → resolución → bitácora de rutas)");

    // ================= Fase 4: temporadas, OC parcial, solicitudes de ruta, consumo =================
    const { enTemporada, estadoTemporada } = await import("../src/lib/temporadas");
    const { avisarInicioDeTemporadas } = await import("../src/lib/temporadasServidor");
    const { tablaMinimos } = await import("../src/lib/minimosServidor");
    const { zonaCedis } = await import("../src/lib/operacion");
    const { fechaEnZona } = await import("../src/lib/zonasHorarias");
    const { cantidadSugerida, consumoPorTienda } = await import("../src/lib/consumo");
    const { duracionEstimada } = await import("../src/lib/rolEntregas");
    const temporadasApi = await import("../src/app/api/operacion/temporadas/route");
    const recibirOC = await import("../src/app/api/ordenes-compra/[id]/recibir/route");
    const solicitudesApi = await import("../src/app/api/solicitudes-ruta/route");
    const solicitudApi = await import("../src/app/api/solicitudes-ruta/[id]/route");
    const OrdenCompra = (await import("../src/models/OrdenCompra")).default;
    const Proveedor = (await import("../src/models/Proveedor")).default;
    const Venta = (await import("../src/models/Venta")).default;

    // ---- Temporadas ----
    const navidad = { activa: true, inicio: "11-15", fin: "01-06" };
    assert.ok(enTemporada(navidad, "2026-12-24") && enTemporada(navidad, "2027-01-03"), "cruza el año");
    assert.ok(!enTemporada(navidad, "2026-07-01"));
    assert.equal(estadoTemporada(navidad, "2026-07-01", 5), "fuera_con_existencia", "fuera de temporada se vende lo que queda");
    assert.equal(estadoTemporada(navidad, "2026-07-01", 0), "bloqueado");
    assert.equal(estadoTemporada({ activa: false }, "2026-07-01", 0), "sin_temporada");

    const dia = fechaEnZona(new Date(), await zonaCedis());
    const mmdd = dia.slice(5);
    const otroMes = `${String(((Number(mmdd.slice(0, 2)) + 5) % 12) + 1).padStart(2, "0")}-01`;
    const rosca = await Producto.create({ sku: "ROS", nombre: "Rosca de reyes", categoria: "Panadería", unidad: "pieza", existenciaMatriz: 0, stockMinimo: 10 });
    const ponche = await Producto.create({ sku: "PON", nombre: "Ponche", categoria: "Abarrotes", unidad: "pieza", existenciaMatriz: 8 });
    const finOtro = `${otroMes.slice(0, 2)}-20`;
    assert.equal((await llamar(temporadasApi, "PATCH", "/api/operacion/temporadas", { productoId: String(rosca._id), inicio: "13-01", fin: "01-06" })).status, 400, "fechas MM-DD válidas");
    assert.equal((await llamar(temporadasApi, "PATCH", "/api/operacion/temporadas", { productoId: String(rosca._id), inicio: otroMes, fin: finOtro })).status, 200);
    const finHoy = `${mmdd.slice(0, 2)}-28`;
    await llamar(temporadasApi, "PATCH", "/api/operacion/temporadas", { productoId: String(ponche._id), inicio: mmdd, fin: finHoy === mmdd ? `${mmdd.slice(0, 2)}-29` : finHoy });
    const listaTemp = await (await llamar(temporadasApi, "GET", "/api/operacion/temporadas")).json();
    assert.equal(listaTemp.productos.find((p: { nombre: string }) => p.nombre === "Rosca de reyes").estado, "bloqueado");
    assert.equal(listaTemp.productos.find((p: { nombre: string }) => p.nombre === "Ponche").estado, "en_temporada");
    const pideRosca = await comoTienda(pedidosApi, "POST", "/api/pedidos", { items: [{ productoId: String(rosca._id), cantidad: 2 }] });
    assert.equal(pideRosca.status, 400, "la tienda no pide lo bloqueado por temporada");
    assert.ok((await pideRosca.json()).error.includes("Rosca de reyes"));
    const minimosHoy = await tablaMinimos({ soloBajo: true });
    assert.ok(!minimosHoy.items.some((i) => i.nombre === "Rosca de reyes"), "fuera de temporada no genera compra por mínimo");
    const aviso = await avisarInicioDeTemporadas();
    assert.equal(aviso.avisados, 1, "el ponche arranca hoy");
    assert.equal((await Producto.findById(ponche._id).lean())!.temporada.avisadoAnio, Number(dia.slice(0, 4)));
    assert.equal((await avisarInicioDeTemporadas()).avisados, 0, "un aviso por año");

    // ---- OC parcial: lo que faltó queda abierto en una remanente ----
    const prov = await Proveedor.create({ nombre: "Distribuidora", whatsapp: "" });
    const nuevaOC = (folio: string) => OrdenCompra.create({ folio, proveedorId: prov._id, estado: "solicitada", items: [{ productoId: fabuloso._id, nombreProducto: "Fabuloso 1L", cantidadOrdenada: 10, precioUnitario: 20 }] });
    const oc1 = await nuevaOC("OC-PARCIAL");
    const rec1 = await (await llamar(recibirOC, "POST", `/api/ordenes-compra/${oc1._id}/recibir`, { avisarProveedor: false, items: [{ productoId: String(fabuloso._id), cantidadRecibida: 6 }] }, { id: String(oc1._id) })).json();
    assert.equal(rec1.remanenteFolio, "OC-PARCIAL-R");
    const remanente = (await OrdenCompra.findOne({ folio: "OC-PARCIAL-R" }).lean())!;
    assert.equal(remanente.estado, "solicitada");
    assert.equal(remanente.items[0].cantidadOrdenada, 4);
    assert.equal(String(remanente.ordenOrigenId), String(oc1._id));
    const oc2 = await nuevaOC("OC-CERRADA");
    const rec2 = await (await llamar(recibirOC, "POST", `/api/ordenes-compra/${oc2._id}/recibir`, { avisarProveedor: false, dejarAbiertoFaltante: false, items: [{ productoId: String(fabuloso._id), cantidadRecibida: 6 }] }, { id: String(oc2._id) })).json();
    assert.equal(rec2.remanenteFolio, null, "si se elige cerrar, no queda remanente");

    // ---- Solicitudes de ruta de Progreso ----
    const fechaSol = "2026-11-09";
    const ruta2 = await Ruta.create({ nombre: "Ruta Progreso", tipo: "especial", horaSalida: "10:00", vehiculoPreferidoId: forte._id, choferResponsableId: chofer._id, paradas: [{ tipo: "sucursal", sucursalId: progreso._id }] });
    void ruta2;
    await llamar(sugerir, "POST", "/api/operacion/rol/sugerir", { fecha: fechaSol });
    const comoProgresoPide = (body: unknown) => comoProgreso(solicitudesApi, "POST", "/api/solicitudes-ruta", body);
    assert.equal((await comoProgresoPide({ direccion: "Calle 1", fecha: fechaSol, horaDesde: "12:00", horaHasta: "11:00" })).status, 400, "horario al revés");
    assert.equal((await comoProgresoPide({ direccion: "Calle 1", fecha: fechaSol, horaDesde: "09:00", horaHasta: "13:00", folioPedido: nuevo.folio })).status, 400, "no liga pedidos de otra tienda");
    const fria = await (await comoProgresoPide({ direccion: "Av. Reforma 10", zona: "Centro", fecha: fechaSol, horaDesde: "09:00", horaHasta: "13:00", frio: "congelado" })).json();
    const normal = await (await comoProgresoPide({ direccion: "Calle Pino 4", zona: "Norte", fecha: fechaSol, horaDesde: "09:30", horaHasta: "12:00" })).json();
    assert.equal(normal.estado, "pendiente");
    const vistaCedis = await (await llamar(solicitudesApi, "GET", "/api/solicitudes-ruta")).json();
    const vFria = vistaCedis.find((s: { _id: string }) => s._id === fria._id);
    const vNormal = vistaCedis.find((s: { _id: string }) => s._id === normal._id);
    assert.equal(vFria.sugeridaId, null, "congelado no cabe en una unidad sin frío");
    assert.ok(vFria.opciones.every((o: { apta: boolean }) => !o.apta));
    assert.ok(vNormal.sugeridaId, "a la normal se le sugiere salida");
    const sid = (s: { _id: string }) => ({ id: s._id });
    assert.equal((await llamar(solicitudApi, "PATCH", `/api/solicitudes-ruta/${fria._id}`, { accion: "confirmar", salidaId: vNormal.sugeridaId }, sid(fria))).status, 400, "no confirma frío en unidad sin frío");
    assert.equal((await comoProgreso(solicitudApi, "PATCH", `/api/solicitudes-ruta/${normal._id}`, { accion: "confirmar", salidaId: vNormal.sugeridaId }, sid(normal))).status, 403, "la tienda no confirma");
    const confirmada = await (await llamar(solicitudApi, "PATCH", `/api/solicitudes-ruta/${normal._id}`, { accion: "confirmar", salidaId: vNormal.sugeridaId }, sid(normal))).json();
    assert.equal(confirmada.estado, "confirmada");
    const rolSol = (await RolEntrega.findOne({ fecha: fechaSol }).lean())!;
    assert.ok(rolSol.salidas.some((s: { paradas: { descripcion?: string }[] }) => s.paradas.some((x) => x.descripcion?.includes(normal.folio))), "la entrega viaja como parada de la salida");
    const repro = await (await llamar(solicitudApi, "PATCH", `/api/solicitudes-ruta/${fria._id}`, { accion: "reprogramar", fecha: "2026-11-10", horaDesde: "08:00", horaHasta: "10:00", comentario: "Sale la estaquita refrigerada" }, sid(fria))).json();
    assert.equal(repro.estado, "reprogramada");
    const aceptada = await (await comoProgreso(solicitudApi, "PATCH", `/api/solicitudes-ruta/${fria._id}`, { accion: "aceptar" }, sid(fria))).json();
    assert.equal(aceptada.estado, "pendiente");
    assert.equal(aceptada.fecha, "2026-11-10", "al aceptar toma el horario propuesto");
    assert.equal((await (await comoTienda(solicitudesApi, "GET", "/api/solicitudes-ruta")).json()).length, 0, "Alcalá no ve las de Progreso");

    // ---- Consumo y tiempos de ruta ----
    assert.equal(cantidadSugerida(3, 4, 2), 2, "3 al día × 2 días − 4 en tienda");
    assert.equal(cantidadSugerida(1, 10, 2), 0);
    await Venta.collection.insertOne({ estado: "completada", corte: "2026-11-02", sucursalId: progreso._id, items: [{ productoId: fabuloso._id, cantidad: 30 }] });
    const consumo = await consumoPorTienda([String(fabuloso._id)], "2026-11-04", { ventanaDias: 30, diasCobertura: 2 });
    assert.deepEqual(consumo.get(String(progreso._id))?.get(String(fabuloso._id)), { stock: 0, consumoDiario: 1, sugerido: 2 });
    assert.equal(duracionEstimada(3, { minutosPorParada: 25, holguraMin: 20 }, 150), 95);
    assert.equal(duracionEstimada(3, { minutosPorParada: 0, holguraMin: 20 }, 150), 150, "sin minutos por parada se usa la típica");

    console.log("OK   fase 4 (temporadas → OC remanente → solicitudes de ruta → consumo y tiempos)");
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
