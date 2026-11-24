import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { importeConLetra } from "../src/lib/importeConLetra";
import { estadoLimiteEfectivo } from "../src/lib/caja";
import { ticketRetiroHTML } from "../src/lib/ticketRetiro";

// Retiro parcial por límite de efectivo: el cajón pasa de fondo + límite, el
// punto de venta lo detecta y el gerente retira con su NIP.

function unitarias() {
  const casos: [number, string][] = [
    [1, "UN PESO 00/100 M.N."],
    [21, "VEINTIÚN PESOS 00/100 M.N."],
    [100, "CIEN PESOS 00/100 M.N."],
    [115.5, "CIENTO QUINCE PESOS 50/100 M.N."],
    [2000, "DOS MIL PESOS 00/100 M.N."],
    [2500, "DOS MIL QUINIENTOS PESOS 00/100 M.N."],
    [1001, "MIL UN PESOS 00/100 M.N."],
    [21000, "VEINTIÚN MIL PESOS 00/100 M.N."],
    [31450.75, "TREINTA Y UN MIL CUATROCIENTOS CINCUENTA PESOS 75/100 M.N."],
    [1000000, "UN MILLÓN DE PESOS 00/100 M.N."],
    [0, "CERO PESOS 00/100 M.N."],
  ];
  for (const [n, esperado] of casos) assert.equal(importeConLetra(n), esperado, String(n));

  // Fondo 1000, límite 2000: el aviso salta al pasar de 3000.
  assert.equal(estadoLimiteEfectivo(3000, 1000, 2000).requiereRetiro, false);
  assert.equal(estadoLimiteEfectivo(3000.01, 1000, 2000).requiereRetiro, true);
  const e = estadoLimiteEfectivo(3480.5, 1000, 2000);
  assert.equal(e.excedente, 2480.5);
  assert.equal(e.sugerido, 2400);
  assert.equal(estadoLimiteEfectivo(99999, 1000, 0).requiereRetiro, false, "0 desactiva el límite");
  assert.equal(estadoLimiteEfectivo(500, 1000, 2000).excedente, 0);

  const html = ticketRetiroHTML(
    {
      folio: "RET-1", fecha: new Date(), monto: 2400, moneda: "MXN", motivo: "Retiro <parcial>", origen: "limite",
      usuarioNombre: "Cajera", autorizadoPorNombre: "Gerente", efectivoAntes: 3480.5, efectivoDespues: 1080.5,
      desglose: [{ denominacion: 500, cantidad: 4 }, { denominacion: 200, cantidad: 2 }],
    },
    { sucursalNombre: "Sucursal X", zonaHoraria: "America/Tijuana", cajero: "Cajera" }
  );
  assert.equal((html.match(/class="corte"/g) ?? []).length, 2, "Dos copias");
  assert.ok(html.includes("COPIA CAJA") && html.includes("COPIA GERENTE"));
  assert.ok(html.includes("DOS MIL CUATROCIENTOS PESOS 00/100 M.N."));
  assert.ok(html.includes("Retiro &lt;parcial&gt;"), "Escapa el motivo");
}

async function integracion() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri("titos_retiro_limite");
  process.env.JWT_SECRET = "solo-pruebas-retiro-limite";
  const { connectDB } = await import("../src/lib/db");
  const { hashPassword, signSession } = await import("../src/lib/auth");
  const { asegurarRolesSemilla } = await import("../src/lib/roles");
  const { sesionVigente } = await import("../src/lib/sesionVigente");
  const { accesoApiPuesto } = await import("../src/lib/accesoPuestos");
  const User = (await import("../src/models/User")).default;
  const Rol = (await import("../src/models/Rol")).default;
  const Sucursal = (await import("../src/models/Sucursal")).default;
  const Producto = (await import("../src/models/Producto")).default;
  const Inventario = (await import("../src/models/InventarioSucursal")).default;
  const MovimientoCaja = (await import("../src/models/MovimientoCaja")).default;
  const { POST: abrirCaja } = await import("../src/app/api/caja/abrir/route");
  const { POST: vender } = await import("../src/app/api/ventas/route");
  const { GET: efectivo } = await import("../src/app/api/caja/actual/efectivo/route");
  const { POST: retirar } = await import("../src/app/api/caja/retiros/route");
  const { PATCH: configurar } = await import("../src/app/api/configuracion/route");

  try {
    await connectDB();
    await asegurarRolesSemilla();
    const gerenteRol = await Rol.findOne({ codigoSistema: "gerente-tienda" });
    // Cajero que solo cobra: no tiene el permiso de retirar.
    const cajeroRol = await Rol.create({ nombre: "Solo cobra", ambito: "sucursal", permisos: ["pos.vender"] });
    const suc = await Sucursal.create({ nombre: "Sucursal límite", clave: "LIM" });
    const admin = await User.create({ nombre: "Admin", email: "admin@lim.local", role: "matriz", passwordHash: await hashPassword("x-pruebas-1") });
    const gerente = await User.create({ nombre: "Gerente Tienda", email: "ger@lim.local", role: "sucursal", sucursalId: suc._id, rolId: gerenteRol._id, passwordHash: await hashPassword("x-pruebas-1"), nipOperacionHash: await hashPassword("246810") });
    const cajero = await User.create({ nombre: "Cajera Uno", email: "caj@lim.local", role: "sucursal", sucursalId: suc._id, rolId: cajeroRol._id, passwordHash: await hashPassword("x-pruebas-1") });
    const payload = (u: typeof admin) => ({ userId: String(u._id), nombre: u.nombre, email: u.email, role: u.role, sucursalId: u.sucursalId ? String(u.sucursalId) : null });
    const tAdmin = await signSession(payload(admin));
    const tCajero = await signSession(payload(cajero));
    const req = (url: string, method = "GET", body?: unknown, auth = tCajero) =>
      new NextRequest(`http://localhost${url}`, { method, headers: { cookie: `titos_session=${auth}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

    // Configuración: el límite se valida y se guarda.
    assert.equal((await configurar(req("/api/configuracion", "PATCH", { limiteEfectivoCajaMxn: -5 }, tAdmin))).status, 400);
    assert.equal((await configurar(req("/api/configuracion", "PATCH", { limiteEfectivoCajaMxn: 2000, fondoCajaMxn: 1000 }, tAdmin))).status, 200);

    // El cajero sin "caja.retirar" puede mandar el POST (lo valida la ruta).
    const sesionCajero = (await sesionVigente(payload(cajero)))!;
    assert.equal(accesoApiPuesto(sesionCajero, "/api/caja/retiros", "POST"), true);

    const abrir = await abrirCaja(req("/api/caja/abrir", "POST", { efectivoInicial: 1000, clienteOperacionId: "apertura-lim" }));
    assert.ok(abrir.status < 300, await abrir.clone().text());

    let estado = await (await efectivo(req("/api/caja/actual/efectivo"))).json();
    assert.equal(estado.abierta, true);
    assert.equal(estado.requiereRetiro, false);
    assert.equal(estado.efectivoEnCaja, 1000);

    const prod = await Producto.create({ nombre: "Caja de prueba", sku: "LIM-1", categoria: "Pruebas", area: "Abarrotes", unidad: "pieza", precioVenta: 2500, existenciaMatriz: 10 });
    await Inventario.create({ sucursalId: suc._id, productoId: prod._id, stockActual: 10 });
    const venta = await vender(req("/api/ventas", "POST", { clienteOperacionId: "venta-lim-1", items: [{ productoId: String(prod._id), cantidad: 1 }], pagos: [{ metodoPago: "efectivo", monto: 2500 }], montoRecibido: 2500 }));
    assert.equal(venta.status, 201, await venta.clone().text());

    estado = await (await efectivo(req("/api/caja/actual/efectivo"))).json();
    assert.equal(estado.efectivoEnCaja, 3500);
    assert.equal(estado.excedente, 2500);
    assert.equal(estado.requiereRetiro, true, "3,500 en caja pasa de 1,000 + 2,000");
    assert.equal(estado.sugerido, 2500);

    const base = { clienteOperacionId: "ret-lim-1", origen: "limite", moneda: "MXN", monto: 2500, motivo: "Retiro parcial por límite de efectivo" };
    // Sin NIP no pasa; con NIP equivocado tampoco.
    assert.equal((await retirar(req("/api/caja/retiros", "POST", { ...base, password: "x-pruebas-1" }))).status, 400);
    assert.equal((await retirar(req("/api/caja/retiros", "POST", { ...base, nipSupervisor: "111111" }))).status, 400);
    // Retiro manual sin el permiso: rechazado.
    assert.equal((await retirar(req("/api/caja/retiros", "POST", { ...base, origen: "manual", nipSupervisor: "246810" }))).status, 403);
    // Desglose que no cuadra con el monto.
    const malDesglose = await retirar(req("/api/caja/retiros", "POST", { ...base, nipSupervisor: "246810", desglose: [{ denominacion: 500, cantidad: 4 }] }));
    assert.equal(malDesglose.status, 400);

    const ok = await retirar(req("/api/caja/retiros", "POST", { ...base, nipSupervisor: "246810", desglose: [{ denominacion: 500, cantidad: 5 }] }));
    assert.equal(ok.status, 201, await ok.clone().text());
    const mov = await ok.json();
    assert.equal(mov.origen, "limite");
    assert.equal(mov.autorizadoPorNombre, "Gerente Tienda");
    assert.equal(mov.usuarioNombre, "Cajera Uno");
    assert.equal(mov.efectivoAntes, 3500);
    assert.equal(mov.efectivoDespues, 1000);
    assert.deepEqual(mov.desglose, [{ denominacion: 500, cantidad: 5 }]);

    // Reintento con el mismo identificador: no saca el dinero dos veces.
    const repetido = await retirar(req("/api/caja/retiros", "POST", { ...base, nipSupervisor: "246810", desglose: [{ denominacion: 500, cantidad: 5 }] }));
    assert.equal((await repetido.json()).folio, mov.folio);
    assert.equal(await MovimientoCaja.countDocuments({}), 1);

    estado = await (await efectivo(req("/api/caja/actual/efectivo"))).json();
    assert.equal(estado.efectivoEnCaja, 1000);
    assert.equal(estado.requiereRetiro, false, "Después del retiro ya no se pide");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

async function main() {
  unitarias();
  await integracion();
  console.log("check-retiro-limite: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
