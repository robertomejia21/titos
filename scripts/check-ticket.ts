import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function main() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: "http://pos.test"});
  const win = dom.window;
  for (const [key, value] of Object.entries({window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, KeyboardEvent: win.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true})) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const {act, createElement} = await import("react");
  const {createRoot} = await import("react-dom/client");
  const {PuntoVentaForm} = await import("../src/components/sucursal/PuntoVentaForm");
  const {ticketVentaHTML} = await import("../src/lib/ticketVenta");
  const venta = {folio: "VTA-TEST", fecha: "2026-09-09T18:00:00Z", items: [{nombreProducto: "Café <prueba>", cantidad: 1, unidad: "pieza", precioUnitario: 10, subtotal: 10}], pagos: [{metodoPago: "efectivo", monto: 10}], total: 10, montoRecibido: 10, cambio: 0};
  const opciones = {zonaHoraria: "America/Tijuana", sucursalNombre: "Tienda prueba"};
  assert.equal((ticketVentaHTML({...venta, pagos: [{metodoPago: "tarjeta", monto: 10}]}, opciones).match(/class="copia"/g) ?? []).length, 2);
  assert.ok(ticketVentaHTML(venta, opciones).includes("Café &lt;prueba&gt;"));
  const originalSetItem = win.Storage.prototype.setItem;
  for (const caso of ["normal", "rechazada", "reintentos", "offline", "sin-espacio", "bloqueada", "error-impresora", "cerrada"] as const) {
    win.localStorage.clear();
    const offline = caso === "offline" || caso === "sin-espacio";
    Object.defineProperty(win.navigator, "onLine", {value: !offline, configurable: true});
    if (caso === "sin-espacio") win.Storage.prototype.setItem = () => {throw new Error("QuotaExceededError");};
    let abiertas = 0;
    let impresiones = 0;
    let cerrada = false;
    let html = "";
    const eventos: string[] = [];
    const solicitudes: {clienteOperacionId: string}[] = [];
    let confirmar!: (r: Response) => void;
    const pendiente = new Promise<Response>((r) => {confirmar = r;});
    Object.defineProperty(win, "open", {configurable: true, value: () => {
      abiertas++; eventos.push("ventana");
      if (caso === "bloqueada") return null;
      return {get closed() {return cerrada;}, close: () => {cerrada = true;}, document: {open: () => {html = "";}, write: (v: string) => {html += v;}, close: () => {}}, focus: () => {}, print: () => {if (caso === "error-impresora") throw new Error("print unavailable"); impresiones++; eventos.push("imprimir");}};
    }});
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "/api/ventas") {
        eventos.push("venta"); solicitudes.push(JSON.parse(String(init?.body)));
        if (caso === "reintentos" && solicitudes.length < 3) throw new TypeError("Failed to fetch");
        return pendiente;
      }
      const datos = url === "/api/productos" ? [{_id: "prod-1", sku: "CAFE", nombre: "Café <prueba>", categoria: "Abarrotes", unidad: "pieza", precioVenta: 10, activo: true}]
        : url === "/api/inventario-sucursal" ? [{productoId: "prod-1", stockActual: 50}]
        : url === "/api/caja/actual" ? {_id: "caja-test", efectivoInicial: 100, fechaApertura: "2026-09-09T17:00:00Z", usuarioAperturaId: {nombre: "Cajero prueba"}}
        : url === "/api/configuracion" ? {tipoCambio: 17} : [];
      return Response.json(datos);
    };
    const contenedor = document.getElementById("root")!;
    const root = createRoot(contenedor);
    await act(async () => {root.render(createElement(PuntoVentaForm, {sucursalNombre: "Tienda prueba"}));});
    const escaner = document.querySelector<HTMLInputElement>('input[placeholder="Escanea o escribe el código y presiona Enter"]')!;
    assert.ok(escaner, `Escáner disponible: ${caso}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(escaner, "CAFE");
      escaner.dispatchEvent(new win.Event("input", {bubbles: true}));
    });
    await act(async () => {(document.querySelector('button[title="Agregar por código"]') as HTMLButtonElement).click();});
    const boton = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto)!;
    await act(async () => {(document.querySelector('button[title="Cobrar — F4"]') as HTMLButtonElement).click();});
    assert.ok(boton("Cobrar") && !boton("Cobrar").disabled, `Cobro habilitado: ${caso}`);
    await act(async () => {boton("Cobrar").click(); if (!offline) boton("Cobrar")?.click();});
    assert.equal(abiertas, 1, `${caso}: una ventana por cobro`);
    if (!offline) {
      assert.equal(impresiones, 0, "No imprime antes de confirmar la venta");
      assert.equal(eventos[0], "ventana", "Reserva antes de solicitar la venta");
      if (caso === "cerrada") cerrada = true;
      await act(async () => {confirmar(caso === "rechazada" ? Response.json({error: "Venta rechazada"}, {status: 400}) : Response.json(venta)); if (caso === "reintentos") await new Promise((r) => setTimeout(r, 1800));});
    }
    if (caso === "rechazada" || caso === "sin-espacio") {
      assert.equal(impresiones, 0); assert.equal(cerrada, true); assert.ok(!boton("Reimprimir ticket"));
    } else {
      assert.ok(boton("Reimprimir ticket"), "Conserva confirmación aunque no se imprima");
      assert.equal(impresiones, ["bloqueada", "error-impresora", "cerrada"].includes(caso) ? 0 : 1);
      if (["bloqueada", "error-impresora", "cerrada"].includes(caso)) assert.ok(document.querySelector('[role="status"]')?.textContent?.includes("guardada"));
      if (caso === "normal") {
        assert.ok(html.includes("VTA-TEST"));
        await act(async () => {root.render(createElement(PuntoVentaForm, {sucursalNombre: "Tienda prueba"}));});
        assert.equal(impresiones, 1, "Un render no reimprime");
        await act(async () => {boton("Reimprimir ticket").click();});
        assert.equal(impresiones, 2, "Reimpresión manual disponible");
      }
      if (caso === "offline") {
        assert.equal(solicitudes.length, 0);
        assert.equal(JSON.parse(win.localStorage.getItem("titos_pos_cola_v1")!).length, 1);
        await act(async () => {confirmar(Response.json(venta)); win.dispatchEvent(new win.Event("online"));});
        assert.equal(solicitudes.length, 1); assert.equal(impresiones, 1, "Sincronizar no reimprime");
      }
      if (caso === "reintentos") {assert.equal(solicitudes.length, 3); assert.equal(new Set(solicitudes.map((s) => s.clienteOperacionId)).size, 1);}
      else if (!offline) assert.equal(solicitudes.length, 1, "Fallar impresión no repite venta ni la encola");
    }
    await act(async () => {root.unmount();});
    win.Storage.prototype.setItem = originalSetItem;
    console.log(`OK: ticket ${caso}`);
  }
  dom.window.close();
}
main().catch((error) => {console.error(error); process.exit(1);});
