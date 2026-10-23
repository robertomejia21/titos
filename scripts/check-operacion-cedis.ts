// Pruebas de la operación del CEDIS (minuta del 21 de octubre): prorrateo y
// prioridad de tiendas, segunda vuelta, recepción con rechazos, mínimos por
// caja y temporada, rotación de perecederos, rol de entregas y faltantes.
// Corre contra un Mongo en memoria: no toca la base real.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { prorratear } from "../src/lib/prorrateo";
import { cantidadAResurtir, enPresentacion, maximoVigente, minimoVigente } from "../src/lib/minimos";
import { evaluarPerecedero, tramosPeps } from "../src/lib/perecederos";
import { asignarPedidos, conflictosDelRol, diaSemanaDe, sugerirRol } from "../src/lib/rolEntregas";
import { faltanteDe } from "../src/lib/segundaVuelta";
import { mensajeRecepcion } from "../src/lib/avisoRecepcion";

const MS_DIA = 86400000;
const total = (a: { cantidadAsignada: number }[]) => a.reduce((s, x) => s + x.cantidadAsignada, 0);
const de = (a: { sucursalId: string; cantidadAsignada: number }[], id: string) => a.find((x) => x.sucursalId === id)!.cantidadAsignada;

function puras() {
  // ---------- Prorrateo ----------
  const demandas = [
    { sucursalId: "a", cantidad: 24, prioridad: 2 },
    { sucursalId: "b", cantidad: 24, prioridad: 1 },
    { sucursalId: "c", cantidad: 24, prioridad: 3 },
  ];
  for (const criterio of ["caja_completa", "proporcional", "prioridad"] as const) {
    const r = prorratear(100, demandas, { criterio, piezasPorCaja: 12 });
    assert.deepEqual(r.map((x) => x.cantidadAsignada), [24, 24, 24], `${criterio}: si alcanza, cada quien lo suyo`);
  }
  // El caso de la minuta: 18 piezas para tres tiendas que pidieron 24.
  const prop = prorratear(18, demandas, { criterio: "proporcional" });
  assert.deepEqual(prop.map((x) => x.cantidadAsignada), [6, 6, 6], "proporcional reparte parejo");
  const prio = prorratear(30, demandas, { criterio: "prioridad" });
  assert.equal(de(prio, "b"), 24, "prioridad 1 se llena primero");
  assert.equal(de(prio, "a"), 6);
  assert.equal(de(prio, "c"), 0);
  // Cajas de 12: 30 piezas = 2 cajas + 6 sueltas. Las cajas van parejo y las
  // sueltas a la tienda prioritaria; nadie recibe piezas de una caja abierta de más.
  const cajas = prorratear(30, demandas, { criterio: "caja_completa", piezasPorCaja: 12 });
  assert.equal(total(cajas), 30, "se usa toda la existencia");
  assert.equal(de(cajas, "b"), 18, "b: una caja + 6 sueltas por prioridad");
  assert.equal(de(cajas, "a"), 12, "a: una caja cerrada");
  assert.equal(de(cajas, "c"), 0, "c: no alcanzó caja; se completa en la segunda vuelta");
  // Una tienda que pidió menos de una caja solo recibe sueltas.
  const chica = prorratear(14, [{ sucursalId: "x", cantidad: 6, prioridad: 1 }, { sucursalId: "y", cantidad: 24, prioridad: 2 }], { criterio: "caja_completa", piezasPorCaja: 12 });
  assert.equal(de(chica, "y"), 12);
  assert.equal(de(chica, "x"), 2);
  // Sin caja configurada, caja_completa se comporta como proporcional.
  assert.deepEqual(prorratear(18, demandas, { criterio: "caja_completa", piezasPorCaja: 0 }).map((x) => x.cantidadAsignada), [6, 6, 6]);
  // Empates de residuo: gana la prioridad.
  const residuo = prorratear(1, [{ sucursalId: "a", cantidad: 5, prioridad: 2 }, { sucursalId: "b", cantidad: 5, prioridad: 1 }], { criterio: "proporcional" });
  assert.equal(de(residuo, "b"), 1, "el residuo se lo lleva la tienda prioritaria");

  // ---------- Mínimos ----------
  const mayonesa = { stockMinimo: 240, stockMaximo: 480, piezasPorCaja: 12, cajasPorTarima: 40, unidad: "pieza" };
  const temporada = { meses: [12], factorMinimos: 1.5 };
  assert.equal(minimoVigente(mayonesa, "2026-10-23", temporada), 240, "octubre: mínimo normal");
  assert.equal(minimoVigente(mayonesa, "2026-12-05", temporada), 360, "diciembre: ×1.5");
  assert.equal(minimoVigente({ ...mayonesa, stockMinimo: 250 }, "2026-12-05", temporada), 384, "se redondea a caja completa");
  assert.equal(minimoVigente({ ...mayonesa, minimoTemporadaAlta: 600 }, "2026-12-05", temporada), 600, "gana el mínimo de temporada propio");
  assert.equal(maximoVigente(mayonesa, "2026-12-05", temporada), 720, "el máximo crece igual");
  assert.equal(enPresentacion(240, mayonesa), "20 cajas (240 pzas)");
  assert.equal(enPresentacion(504, mayonesa), "1 tarima + 2 cajas (504 pzas)");
  assert.equal(enPresentacion(35, { unidad: "kg" }), "35 kg");
  assert.equal(cantidadAResurtir(100, 240, 480, mayonesa), 384, "se pide a caja completa hasta el máximo");

  // ---------- Perecederos ----------
  const ahora = new Date("2026-10-23T12:00:00Z");
  const hace = (dias: number) => new Date(ahora.getTime() - dias * MS_DIA);
  const tramos = tramosPeps(30, [{ fecha: hace(1), cantidad: 20 }, { fecha: hace(5), cantidad: 15 }], 6, ahora);
  assert.deepEqual(tramos.map((t) => [t.cantidad, t.diasEnAlmacen, t.estado]), [[20, 1, "fresco"], [10, 5, "urgente"]], "PEPS: quedan los 20 nuevos y 10 de los viejos");
  const platano = evaluarPerecedero({ existencia: 30, entradas: [{ fecha: hace(1), cantidad: 20 }, { fecha: hace(5), cantidad: 15 }], vidaUtilDias: 6, salidaDiaria: 5, ahora });
  assert.equal(platano.estado, "urgente");
  assert.equal(platano.cantidadEnRiesgo, 10);
  assert.ok(platano.excedente > 0, "a 5 por día no alcanzan a salir los 30 en su vida útil");
  const sinHistorial = evaluarPerecedero({ existencia: 8, entradas: [], vidaUtilDias: 5, salidaDiaria: 2, ahora });
  assert.equal(sinHistorial.estado, "sin_fecha");
  const fresco = evaluarPerecedero({ existencia: 4, entradas: [{ fecha: hace(0), cantidad: 4 }], vidaUtilDias: 7, salidaDiaria: 2, ahora });
  assert.equal(fresco.estado, "fresco");
  assert.equal(fresco.excedente, 0);

  // ---------- Rol de entregas ----------
  assert.equal(diaSemanaDe("2026-10-22"), "jueves");
  assert.equal(diaSemanaDe("2026-10-25"), "domingo");
  const rutas = [
    { _id: "homechef", nombre: "Home Chef", tipo: "primera_vuelta" as const, horaSalida: "06:30", requiereRefrigerado: true, choferResponsableId: "luis", choferSustitutoId: "pedro", paradas: [{ tipo: "sucursal", sucursalId: "hc" }] },
    { _id: "troque", nombre: "Troque Grande", tipo: "primera_vuelta" as const, horaSalida: "07:00", vehiculoPreferidoId: "forte", choferResponsableId: "luis", paradas: [{ tipo: "sucursal", sucursalId: "xochi" }, { tipo: "sucursal", sucursalId: "glorieta" }] },
    { _id: "v2", nombre: "Segunda vuelta", tipo: "segunda_vuelta" as const, horaSalida: "10:40", duracionMin: 90, choferResponsableId: "luis", paradas: [{ tipo: "sucursal", sucursalId: "glorieta" }] },
    { _id: "reciclaje", nombre: "Reciclaje", tipo: "especial" as const, horaSalida: "14:00", diasSemana: ["jueves"], paradas: [{ tipo: "basura", descripcion: "Cartón a recicladora" }] },
  ];
  const vehiculos = [
    { _id: "e1", nombre: "Estaquita 1", refrigerado: true },
    { _id: "e3", nombre: "Estaquita 3", refrigerado: false },
    { _id: "forte", nombre: "Forte", refrigerado: false },
  ];
  const choferes = [{ _id: "luis", nombre: "Luis" }, { _id: "pedro", nombre: "Pedro" }, { _id: "ana", nombre: "Ana" }];
  const miercoles = sugerirRol({ rutas, vehiculos, choferes, fecha: "2026-10-21", duracionDefaultMin: 150, salidasRecientes: new Map([["pedro", 9], ["ana", 2]]) });
  assert.deepEqual(miercoles.map((s) => s.nombre), ["Home Chef", "Troque Grande", "Segunda vuelta"], "el reciclaje solo sale en jueves");
  assert.equal(miercoles[0].vehiculoId, "e1", "Home Chef va en refrigerada");
  assert.equal(miercoles[0].choferId, "luis", "responsable");
  assert.equal(miercoles[1].vehiculoId, "forte", "unidad preferida");
  assert.equal(miercoles[1].choferId, "ana", "Luis está en Home Chef y la ruta no tiene sustituto: rota al de menos salidas");
  assert.equal(miercoles[2].choferId, "luis", "Luis ya regresó de Home Chef (06:30 + 150 min) para la segunda vuelta");
  assert.equal(miercoles[2].vehiculoId, "e3", "se prefiere unidad seca para una ruta sin perecedero");
  assert.ok(miercoles[1].motivoSugerencia.includes("rotación"));
  const jueves = sugerirRol({ rutas, vehiculos, choferes, fecha: "2026-10-22", duracionDefaultMin: 150 });
  assert.equal(jueves.length, 4);
  const asignacion = asignarPedidos(miercoles, [
    { _id: "p1", sucursalId: "glorieta", vuelta: 1 },
    { _id: "p2", sucursalId: "glorieta", vuelta: 2 },
    { _id: "p3", sucursalId: "otra", vuelta: 1 },
  ]);
  assert.deepEqual(asignacion.map((a) => a.indice), [1, 2, -1], "original a primera vuelta, complemento a segunda, sin ruta queda suelto");
  assert.equal(conflictosDelRol([
    { nombre: "A", horaSalida: "07:00", duracionMin: 120, choferId: "luis", vehiculoId: "e1" },
    { nombre: "B", horaSalida: "08:00", duracionMin: 60, choferId: "luis", vehiculoId: "e3" },
  ]).length, 1, "detecta chofer en dos salidas a la vez");

  // ---------- Segunda vuelta y aviso ----------
  assert.equal(faltanteDe({ cantidadPedida: 24, cantidadAsignada: 6, cantidadSurtida: null }), 18);
  assert.equal(faltanteDe({ cantidadPedida: 24, cantidadAsignada: 6, cantidadSurtida: 4, cantidadComplementada: 10 }), 10);
  assert.equal(faltanteDe({ cantidadPedida: 24, cantidadAsignada: 24, cantidadSurtida: 24 }), 0);
  const texto = mensajeRecepcion(
    { folio: "OC-1", items: [{ nombreProducto: "Fresa", cantidadOrdenada: 30, cantidadRecibida: 10, cantidadRechazada: 20, motivoRechazo: "sobreinventario" }, { nombreProducto: "Tomate", cantidadOrdenada: 20, cantidadRecibida: 10, cantidadRechazada: 0 }] },
    "Frutas Alonso",
    2
  );
  assert.ok(texto.includes("Fresa: llegaron 30, se reciben 10 y se regresan 20 — Sobreinventario"));
  assert.ok(texto.includes("Tomate: llegaron 10 de 20 (faltan 10)"));
  assert.ok(texto.includes("2 fotos"));
  console.log("OK   lógica pura (prorrateo, mínimos, perecederos, rol, aviso)");
}

async function integracion() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_operacion_pruebas");
  process.env.JWT_SECRET = "solo-pruebas-aisladas-operacion-2026";
  try {
    const { connectDB } = await import("../src/lib/db");
    const { signSession } = await import("../src/lib/auth");
    const User = (await import("../src/models/User")).default;
    const Sucursal = (await import("../src/models/Sucursal")).default;
    const Producto = (await import("../src/models/Producto")).default;
    const Proveedor = (await import("../src/models/Proveedor")).default;
    const Pedido = (await import("../src/models/Pedido")).default;
    const OrdenCompra = (await import("../src/models/OrdenCompra")).default;
    const NecesidadCompra = (await import("../src/models/NecesidadCompra")).default;
    const Empleado = (await import("../src/models/Empleado")).default;
    const Vehiculo = (await import("../src/models/Vehiculo")).default;
    const Ruta = (await import("../src/models/Ruta")).default;
    const MovimientoInventario = (await import("../src/models/MovimientoInventario")).default;
    const { obtenerConfiguracionOperacion } = await import("../src/lib/operacion");
    const nivelar = await import("../src/app/api/pedidos/nivelar/route");
    const surtir = await import("../src/app/api/pedidos/[id]/surtir/route");
    const recibirOC = await import("../src/app/api/ordenes-compra/[id]/recibir/route");
    const evidencias = await import("../src/app/api/ordenes-compra/[id]/evidencias/route");
    const sugerir = await import("../src/app/api/operacion/rol/sugerir/route");
    const rolApi = await import("../src/app/api/operacion/rol/route");
    const minimosApi = await import("../src/app/api/operacion/minimos/route");
    const necesidadesApi = await import("../src/app/api/operacion/minimos/necesidades/route");
    const perecederosApi = await import("../src/app/api/operacion/perecederos/route");
    const faltantesApi = await import("../src/app/api/operacion/faltantes/route");
    const configApi = await import("../src/app/api/operacion/config/route");
    const segundaApi = await import("../src/app/api/operacion/segunda-vuelta/route");

    await connectDB();
    const cedis = await Sucursal.create({ nombre: "Cedis", esMatriz: true });
    const [xochi, glorieta, jr] = await Sucursal.create([{ nombre: "Sucursal Xochimilco" }, { nombre: "Sucursal Glorieta" }, { nombre: "Sucursal JR" }]);
    void cedis;
    const admin = await User.create({ nombre: "Coordinador", email: "coord@titos.local", passwordHash: "x", role: "matriz" });
    const token = await signSession({ userId: String(admin._id), email: admin.email, nombre: admin.nombre, role: "matriz", sucursalId: null });
    const llamar = (mod: Record<string, unknown>, metodo: string, url: string, body?: unknown, params?: Record<string, string>) =>
      (mod[metodo] as (req: NextRequest, ctx?: unknown) => Promise<Response>)(
        new NextRequest(`http://localhost${url}`, { method: metodo, headers: { cookie: `titos_session=${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
        params ? { params: Promise.resolve(params) } : undefined
      );

    // Configuración: prioridad Glorieta > Xochimilco > JR, cajas completas.
    const cfg = await llamar(configApi, "PATCH", "/api/operacion/config", { criterioProrrateo: "caja_completa", prioridadSucursales: [{ sucursalId: String(glorieta._id) }, { sucursalId: String(xochi._id) }, { sucursalId: String(jr._id) }] });
    assert.equal(cfg.status, 200);
    assert.equal((await cfg.json()).prioridadSucursales[0].prioridad, 1);
    assert.equal((await llamar(configApi, "PATCH", "/api/operacion/config", { temporadaAlta: { meses: [13] } })).status, 400);

    const mayonesa = await Producto.create({ sku: "MAY", nombre: "Mayonesa 500ml", categoria: "Otros", unidad: "pieza", existenciaMatriz: 30, piezasPorCaja: 12, stockMinimo: 120, stockMaximo: 240, esClave: true });
    const platano = await Producto.create({ sku: "PLA", nombre: "Plátano dominico", categoria: "Otros", unidad: "kg", existenciaMatriz: 0, vidaUtilDias: 6 });
    const proveedor = await Proveedor.create({ nombre: "Abarrotes Alonso", contacto: "Sr. Alonso", whatsapp: "" });
    const item = (p: typeof mayonesa, cantidad: number) => ({ productoId: p._id, nombreProducto: p.nombre, unidad: p.unidad, cantidadPedida: cantidad });
    const ayer = new Date(Date.now() - 3600000);
    const pedidos = await Pedido.create([
      { folio: "P-XOCHI", sucursalId: xochi._id, corte: "2026-10-22", fecha: ayer, items: [item(mayonesa, 24)] },
      { folio: "P-GLOR", sucursalId: glorieta._id, corte: "2026-10-22", fecha: ayer, items: [item(mayonesa, 24)] },
      { folio: "P-JR", sucursalId: jr._id, corte: "2026-10-22", fecha: ayer, items: [item(mayonesa, 24), item(platano, 10)] },
    ]);

    // ---- Nivelador con cajas completas y prioridad ----
    const niv = await llamar(nivelar, "POST", "/api/pedidos/nivelar", {});
    assert.equal(niv.status, 200);
    assert.equal((await niv.json()).criterio, "caja_completa");
    const asignado = async (folio: string) => (await Pedido.findOne({ folio }).lean())!.items[0].cantidadAsignada;
    assert.equal(await asignado("P-GLOR"), 18, "Glorieta (prioridad 1): una caja + 6 sueltas");
    assert.equal(await asignado("P-XOCHI"), 12, "Xochimilco: una caja cerrada");
    assert.equal(await asignado("P-JR"), 0, "JR: espera la segunda vuelta");
    assert.equal((await Producto.findById(mayonesa._id).lean())!.existenciaMatriz, 0);
    assert.equal(await NecesidadCompra.countDocuments({ motivo: "faltante_pedido" }), 2, "faltan mayonesa y plátano");

    for (const p of pedidos) {
      const doc = (await Pedido.findById(p._id).lean())!;
      const res = await llamar(surtir, "POST", `/api/pedidos/${p._id}/surtir`, { items: doc.items.map((i: { productoId: unknown; cantidadAsignada: number }) => ({ productoId: String(i.productoId), cantidadSurtida: i.cantidadAsignada })) }, { id: String(p._id) });
      assert.equal(res.status, 200);
    }

    // ---- Recepción de OC con rechazo + evidencia → segunda vuelta automática ----
    const oc = await OrdenCompra.create({
      folio: "OC-PRUEBA", proveedorId: proveedor._id, estado: "solicitada",
      items: [
        { productoId: mayonesa._id, nombreProducto: mayonesa.nombre, cantidadOrdenada: 48, precioUnitario: 20 },
        { productoId: platano._id, nombreProducto: platano.nombre, cantidadOrdenada: 30, precioUnitario: 15 },
      ],
    });
    const foto = "data:image/jpeg;base64," + Buffer.from("foto-de-prueba").toString("base64");
    assert.equal((await llamar(evidencias, "POST", `/api/ordenes-compra/${oc._id}/evidencias`, { imagen: foto, productoId: String(platano._id), nota: "Quemado por frío" }, { id: String(oc._id) })).status, 201);
    assert.equal((await llamar(evidencias, "POST", `/api/ordenes-compra/${oc._id}/evidencias`, { imagen: "data:text/html;base64,AAAA" }, { id: String(oc._id) })).status, 400);
    const sinMotivo = await llamar(recibirOC, "POST", `/api/ordenes-compra/${oc._id}/recibir`, { items: [
      { productoId: String(mayonesa._id), cantidadRecibida: 48 },
      { productoId: String(platano._id), cantidadRecibida: 10, cantidadRechazada: 20 },
    ] }, { id: String(oc._id) });
    assert.equal(sinMotivo.status, 400, "un rechazo sin motivo no pasa");
    const rec = await llamar(recibirOC, "POST", `/api/ordenes-compra/${oc._id}/recibir`, { avisarProveedor: true, items: [
      { productoId: String(mayonesa._id), cantidadRecibida: 48 },
      { productoId: String(platano._id), cantidadRecibida: 10, cantidadRechazada: 20, motivoRechazo: "quemado_frio", notaRecepcion: "Verde por daño de frío" },
    ] }, { id: String(oc._id) });
    assert.equal(rec.status, 200);
    const recibida = await rec.json();
    const itemPlatano = recibida.items.find((i: { productoId: string }) => String(i.productoId) === String(platano._id));
    assert.equal(itemPlatano.cantidadRechazada, 20);
    assert.equal(itemPlatano.existenciaPrevia, 0, "se guarda la existencia de antes de recibir");
    assert.equal(recibida.avisoRecepcion.estado, "sin_destinatarios", "sin WhatsApp configurado no se manda nada, pero queda constancia");
    assert.equal(recibida.segundaVuelta.complementos.length, 3, "Xochimilco, Glorieta y JR reciben su complemento");
    const v2 = await Pedido.find({ vuelta: 2 }).lean();
    const v2De = (folio: string) => v2.find((p) => p.folio === `${folio}-V2`)!;
    assert.equal(v2De("P-JR").items.find((i: { nombreProducto: string }) => i.nombreProducto === mayonesa.nombre)!.cantidadPedida, 24);
    assert.equal(v2De("P-JR").items.find((i: { nombreProducto: string }) => i.nombreProducto === platano.nombre)!.cantidadPedida, 10);
    assert.equal(v2De("P-XOCHI").items[0].cantidadPedida, 12);
    assert.equal(v2De("P-GLOR").items[0].cantidadPedida, 6);
    assert.equal(v2De("P-JR").estado, "nivelado", "el complemento queda listo para surtir");
    assert.equal(String(v2De("P-JR").pedidoOrigenId), String(pedidos[2]._id));
    const original = (await Pedido.findOne({ folio: "P-JR" }).lean())!;
    assert.equal(original.items[0].cantidadPedida, 24, "el original no se toca");
    assert.equal(original.items[0].cantidadComplementada, 24);
    assert.equal((await Producto.findById(mayonesa._id).lean())!.existenciaMatriz, 6, "48 recibidas - 42 de complemento");
    const otraVez = await (await llamar(segundaApi, "POST", "/api/operacion/segunda-vuelta", {})).json();
    assert.equal(otraVez.complementos.length, 0, "no se duplica el complemento");
    assert.equal((await (await llamar(segundaApi, "GET", "/api/operacion/segunda-vuelta")).json()).length, 0, "ya no queda nada corto");

    // ---- Rol de entregas ----
    const [luis, ana] = await Empleado.create([{ nombre: "Luis", puesto: "Chofer", whatsapp: "0" }, { nombre: "Ana", puesto: "Repartidor", whatsapp: "0" }]);
    const [forte, est] = await Vehiculo.create([{ nombre: "Forte", tipo: "camion" }, { nombre: "Estaquita 1", tipo: "estaquita", refrigerado: true }]);
    void est;
    await Ruta.create([
      { nombre: "Troque Grande", tipo: "primera_vuelta", horaSalida: "07:00", vehiculoPreferidoId: forte._id, choferResponsableId: luis._id, paradas: [{ tipo: "sucursal", sucursalId: xochi._id }, { tipo: "sucursal", sucursalId: glorieta._id }, { tipo: "basura", descripcion: "Cartón de Glorieta a Junior" }] },
      { nombre: "Segunda vuelta", tipo: "segunda_vuelta", horaSalida: "10:40", choferResponsableId: ana._id, paradas: [{ tipo: "sucursal", sucursalId: jr._id }, { tipo: "sucursal", sucursalId: glorieta._id }, { tipo: "sucursal", sucursalId: xochi._id }] },
    ]);
    const rol = await (await llamar(sugerir, "POST", "/api/operacion/rol/sugerir", { fecha: "2026-10-23" })).json();
    assert.equal(rol.salidas.length, 2);
    assert.equal(rol.salidas[0].choferNombre, "Luis");
    assert.equal(rol.salidas[0].vehiculoNombre, "Forte");
    assert.ok(rol.salidas[0].paradas.some((p: { nombre: string }) => p.nombre.includes("Cartón")), "la recolección de basura viaja con la salida");
    assert.deepEqual(rol.salidas[0].pedidos.map((p: { folio: string }) => p.folio).sort(), ["P-GLOR", "P-XOCHI"]);
    assert.deepEqual(rol.salidas[1].pedidos.map((p: { folio: string }) => p.folio).sort(), ["P-GLOR-V2", "P-JR", "P-JR-V2", "P-XOCHI-V2"], "complementos a la segunda vuelta; JR no tiene primera vuelta y cae en la única ruta que pasa por ahí");
    assert.equal(rol.pedidosSinSalida.length, 0);
    assert.equal(String((await Pedido.findOne({ folio: "P-XOCHI" }).lean())!.repartidorId), String(luis._id), "el chofer queda como repartidor del pedido");
    // Ajuste manual: P-JR sale de la ruta y queda suelto; Ana también en la primera (empalme).
    const editado = rol.salidas.map((s: Record<string, unknown>) => ({ ...s, pedidoIds: (s.pedidos as { _id: string; folio: string }[]).filter((p) => p.folio !== "P-JR").map((p) => p._id) }));
    editado[0].choferId = String(ana._id);
    editado[0].ajustadaManualmente = true;
    editado[1].horaSalida = "08:00";
    const guardado = await (await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: "2026-10-23", salidas: editado })).json();
    assert.equal(guardado.pedidosSinSalida.map((p: { folio: string }) => p.folio).join(), "P-JR", "lo que se saca a mano queda visible como pendiente de asignar");
    const acomodado = await (await llamar(sugerir, "POST", "/api/operacion/rol/sugerir", { fecha: "2026-10-23", soloPedidos: true })).json();
    assert.equal(acomodado.pedidosSinSalida.length, 0, "acomodar pendientes no rehace el rol");
    assert.equal(acomodado.salidas[0].choferNombre, "Ana", "y respeta el ajuste manual");
    assert.equal(guardado.salidas[0].ajustadaManualmente, true);
    assert.equal(guardado.conflictos.length, 2, "avisa que Ana y el Forte quedaron en dos salidas a la vez");
    assert.ok(guardado.conflictos.some((c: string) => c.includes("mismo chofer")));
    editado[1].pedidoIds.push(editado[0].pedidoIds[0]);
    assert.equal((await llamar(rolApi, "PUT", "/api/operacion/rol", { fecha: "2026-10-23", salidas: editado })).status, 400, "un folio no va en dos salidas");

    // ---- Mínimos ----
    const tabla = await (await llamar(minimosApi, "GET", "/api/operacion/minimos?clave=1")).json();
    assert.equal(tabla.items.length, 1);
    assert.equal(tabla.items[0].bajoMinimo, true, "6 piezas contra mínimo de 120");
    assert.equal(tabla.items[0].aResurtir, 240, "hasta el máximo, en cajas de 12");
    assert.equal(tabla.items[0].necesidadPendiente, true, "el Nivelador ya la mandó a Compras");
    assert.equal((await (await llamar(necesidadesApi, "POST", "/api/operacion/minimos/necesidades", {})).json()).creadas, 0, "no se duplica lo que ya está en Compras");
    await NecesidadCompra.updateMany({}, { $set: { estado: "asignada" } });
    assert.equal((await (await llamar(necesidadesApi, "POST", "/api/operacion/minimos/necesidades", {})).json()).creadas, 1);
    assert.equal((await NecesidadCompra.findOne({ motivo: "bajo_minimo" }).lean())!.cantidadRequerida, 240);
    assert.equal((await (await llamar(necesidadesApi, "POST", "/api/operacion/minimos/necesidades", {})).json()).creadas, 0, "no se duplica la necesidad");
    assert.equal((await llamar(minimosApi, "PATCH", "/api/operacion/minimos", { cambios: [{ productoId: String(mayonesa._id), stockMinimo: 300, stockMaximo: 100 }] })).status, 400);
    assert.equal((await (await llamar(minimosApi, "PATCH", "/api/operacion/minimos", { cambios: [{ productoId: String(mayonesa._id), cajasPorTarima: 40 }] })).json()).actualizados, 1);

    // ---- Perecederos ----
    await MovimientoInventario.updateMany({ productoId: platano._id, tipo: "entrada_proveedor" }, { $set: { fecha: new Date(Date.now() - 5 * MS_DIA) } });
    await Producto.updateOne({ _id: platano._id }, { $set: { existenciaMatriz: 10 } });
    const rot = await (await llamar(perecederosApi, "GET", "/api/operacion/perecederos")).json();
    assert.equal(rot.length, 1);
    assert.equal(rot[0].estado, "urgente", "5 días de 6 de vida útil");

    // ---- Faltantes del día ----
    const falt = await (await llamar(faltantesApi, "GET", "/api/operacion/faltantes")).json();
    assert.equal(falt.porProveedor.length, 1);
    assert.ok(falt.porProveedor[0].mensaje.includes("Plátano dominico: 10 recibidas vs 30 pedidas — se regresan 20 (Quemado por frío)"));
    assert.ok(falt.resumenInterno.includes("Perecederos por mover primero"));
    const envio = await (await llamar(faltantesApi, "POST", "/api/operacion/faltantes", {})).json();
    assert.equal(envio.enviado, false, "sin destinatarios no se marca como enviado");

    const config = await obtenerConfiguracionOperacion();
    assert.ok(config.pantallaToken.length >= 20, "la pantalla tiene llave propia");
    console.log("OK   integración (nivelador → recepción → segunda vuelta → rol → mínimos → perecederos → faltantes)");
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
