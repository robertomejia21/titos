// Toma las capturas de pantalla que ilustran las presentaciones de avances.
// Uso: node scripts/capturar-presentacion.mjs [--semana=6]
// Requiere el servidor de desarrollo corriendo en http://localhost:3000.
//
// Cada pantalla pertenece a la semana en la que se presentó. Sin --semana se
// retoman TODAS, lo que reescribe también las de semanas pasadas; para no tocar
// el histórico, captura solo la semana que estés armando.
//
// Las credenciales se leen de variables de entorno para no dejarlas escritas
// en el repositorio:
//   PRESENTACION_MATRIZ_EMAIL / PRESENTACION_MATRIZ_PASSWORD
//   PRESENTACION_SUCURSAL_EMAIL / PRESENTACION_SUCURSAL_PASSWORD

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.PRESENTACION_BASE_URL ?? "http://localhost:3000";
const SALIDA = "public/presentacion/img";

const CUENTAS = {
  matriz: {
    email: process.env.PRESENTACION_MATRIZ_EMAIL,
    password: process.env.PRESENTACION_MATRIZ_PASSWORD,
  },
  sucursal: {
    email: process.env.PRESENTACION_SUCURSAL_EMAIL,
    password: process.env.PRESENTACION_SUCURSAL_PASSWORD,
  },
};

/** Oculta el indicador de compilación de Next para que no salga en las capturas. */
async function ocultarOverlayDev(page) {
  await page
    .addStyleTag({
      content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button],
                [data-next-badge-root], [data-next-badge], #__next-build-watcher
                { display: none !important; }`,
    })
    .catch(() => {});
}

/**
 * Término de búsqueda tomado del catálogo real: la primera palabra de al menos
 * 4 letras, para que la búsqueda devuelva resultados y no una cadena cortada.
 */
async function terminoDeBusqueda(page) {
  const productos = await page.evaluate(async () => {
    const res = await fetch("/api/productos");
    if (!res.ok) return [];
    return res.json();
  });

  for (const producto of productos.slice(0, 40)) {
    const palabra = String(producto?.nombre ?? "")
      .split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/)
      .find((p) => p.length >= 4);
    if (palabra) return palabra;
  }
  return "";
}

// Acciones previas al screenshot. Todas son de solo lectura o puramente de
// interfaz: ninguna guarda nada en la base de datos.
const ACCIONES = {
  async abrirModalSucursal(page) {
    await page.getByRole("button", { name: /Ver \/ Editar/i }).first().click();
    await page.waitForTimeout(800);
  },

  async buscarStockOtrasSucursales(page) {
    const termino = await terminoDeBusqueda(page);
    if (!termino) return;
    await page.getByPlaceholder(/Nombre, SKU o alias/i).fill(termino);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    // Espera a que pinten los resultados, no solo a que termine la petición.
    await page.getByText(/Tú tienes/).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
  },

  async pedirPrestado(page) {
    await ACCIONES.buscarStockOtrasSucursales(page);
    // El primer chip de sucursal con existencia abre el modal de solicitud.
    const chip = page.locator("button", { hasText: /Sucursal/ }).last();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.getByText(/Pedir prestado a/).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
    }
  },

  async cobroConCredito(page) {
    const termino = await terminoDeBusqueda(page);
    if (!termino) return;

    await page.getByPlaceholder(/Buscar por nombre o SKU/i).fill(termino);
    // Las opciones del combobox se eligen con mousedown, no con el teclado.
    const opcion = page.locator("div.absolute.z-10 button").first();
    await opcion.waitFor({ timeout: 8000 });
    await opcion.click();
    await page.waitForTimeout(700);

    // Si el producto se vende por peso, el POS pide capturarlo antes de agregarlo.
    const modalPeso = page.getByText(/Capturar peso/).first();
    if (await modalPeso.isVisible().catch(() => false)) {
      await page.getByPlaceholder("0.00").first().fill("1.5").catch(() => {});
      await page.locator('input[type="number"]').first().fill("1.5").catch(() => {});
      await page.getByRole("button", { name: /Agregar al carrito/i }).click();
      await page.waitForTimeout(700);
    }

    await page.locator('button[title^="Cobrar"]').click();
    await page.getByText(/Total a pagar/).first().waitFor({ timeout: 8000 });

    // Si la sucursal ya tiene clientes dados de alta, se elige uno para que la
    // captura muestre la ficha de crédito y el pago a crédito.
    const selectCliente = page.locator("select").first();
    const opciones = await selectCliente.locator("option").count().catch(() => 0);
    if (opciones > 1) {
      const valor = await selectCliente.locator("option").nth(1).getAttribute("value");
      if (valor) await selectCliente.selectOption(valor).catch(() => {});
      await page.waitForTimeout(600);
    }

    await page.waitForTimeout(400);
  },

  async altaCliente(page) {
    await page.getByRole("button", { name: /Nuevo cliente/i }).click();
    await page.waitForTimeout(800);
  },

  // ── Semana 6 ────────────────────────────────────────────────────────

  /** Deja el menú de matriz en modo iconos para mostrar el espacio que libera. */
  async contraerMenu(page) {
    await page.getByRole("button", { name: /Contraer menú/i }).click();
    await page.waitForTimeout(600);
  },

  /** Baja hasta la tarjeta del NIP de supervisor. */
  async verNipSupervisor(page) {
    await page.getByText("NIP de supervisor").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  },

  /** Abre el formulario de facturación de la primera venta pendiente. */
  async abrirModalFactura(page) {
    await page.getByRole("button", { name: "Facturar", exact: true }).first().click();
    await page.getByText(/Razón social/i).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
  },

  /** Cambia a la pestaña de facturas ya emitidas. */
  async verFacturasEmitidas(page) {
    await page.getByRole("button", { name: /Facturas emitidas/i }).click();
    await page.waitForTimeout(1200);
  },

  /** Abre el alta de cliente y enfoca el bloque de la constancia fiscal. */
  async altaClienteConstancia(page) {
    await page.getByRole("button", { name: /Nuevo cliente/i }).click();
    await page.getByText(/Alta desde constancia fiscal/i).first().waitFor({ timeout: 10000 });
    await page.getByText(/Alta desde constancia fiscal/i).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  },

  /**
   * Captura un producto en el carrito y pide quitarlo, para que se vea el modal
   * de autorización. Todo pasa en la interfaz: no se cobra ni se guarda nada.
   */
  async cancelacionEnPuntoVenta(page) {
    const termino = await terminoDeBusqueda(page);
    if (!termino) return;

    await page.getByPlaceholder(/Buscar por nombre o SKU/i).fill(termino);
    const opcion = page.locator("div.absolute.z-10 button").first();
    await opcion.waitFor({ timeout: 8000 });
    await opcion.click();
    await page.waitForTimeout(700);

    const modalPeso = page.getByText(/Capturar peso/).first();
    if (await modalPeso.isVisible().catch(() => false)) {
      await page.locator('input[type="number"]').first().fill("1.5").catch(() => {});
      await page.getByRole("button", { name: /Agregar al carrito/i }).click();
      await page.waitForTimeout(700);
    }

    await page.locator('button[title^="Quitar"]').first().click();
    await page.getByText(/Autorizar cancelación/i).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
  },

  // ── Semana 7 ────────────────────────────────────────────────────────

  /** Deja un producto en el carrito; base de las capturas del cobro. */
  async cargarCarrito(page) {
    const termino = await terminoDeBusqueda(page);
    if (!termino) return false;

    await page.getByPlaceholder(/Buscar por nombre o SKU/i).fill(termino);
    const opcion = page.locator("div.absolute.z-10 button").first();
    await opcion.waitFor({ timeout: 8000 });
    await opcion.click();
    await page.waitForTimeout(700);

    const modalPeso = page.getByText(/Capturar peso/).first();
    if (await modalPeso.isVisible().catch(() => false)) {
      await page.locator('input[type="number"]').first().fill("1.5").catch(() => {});
      await page.getByRole("button", { name: /Agregar al carrito/i }).click();
      await page.waitForTimeout(700);
    }
    return true;
  },

  /** Modal de cobro sin capturar nada: se ven las cinco formas de pago. */
  async formasDePago(page) {
    if (!(await ACCIONES.cargarCarrito(page))) return;
    await page.locator('button[title^="Cobrar"]').click();
    await page.getByText(/Total a pagar/).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
  },

  /** Abre el cobro con una parte pagada en vales de despensa. */
  async cobroConVales(page) {
    if (!(await ACCIONES.cargarCarrito(page))) return;

    await page.locator('button[title^="Cobrar"]').click();
    await page.getByText(/Total a pagar/).first().waitFor({ timeout: 8000 });

    // Se reparte el cobro para que se vea el pago mixto con vales.
    await page.getByPlaceholder("Vales de despensa").fill("50");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Completar" }).first().click();
    await page.waitForTimeout(600);
  },

  /** Deja abierto el modal de cancelación con su selector de motivo. */
  async abrirCancelacion(page) {
    if (!(await ACCIONES.cargarCarrito(page))) return null;

    await page.locator('button[title^="Quitar"]').first().click();
    await page.getByText(/Autorizar cancelación/i).first().waitFor({ timeout: 8000 });
    return page.locator("select").filter({ hasText: "Selecciona un motivo" }).first();
  },

  /**
   * Cancelación con uno de los motivos del catálogo ya elegido. El desplegable
   * nativo no sale en las capturas, así que se muestra el motivo seleccionado.
   */
  async motivoDeCancelacion(page) {
    const select = await ACCIONES.abrirCancelacion(page);
    if (!select) return;
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(700);
  },

  /** La salida "Otro": el cajero captura un motivo que no está en la lista. */
  async motivoOtro(page) {
    const select = await ACCIONES.abrirCancelacion(page);
    if (!select) return;
    await select.selectOption({ label: "Otro (especificar)" });
    await page.getByPlaceholder("Describe el motivo").fill("Se cayó el producto al piso");
    await page.waitForTimeout(700);
  },

  /** Baja a la tarjeta del catálogo de motivos de cancelación y devolución. */
  async verMotivosConfigurados(page) {
    await page.getByText(/Motivos de cancelación y devolución/i).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
  },

  // ── Semana 8 ────────────────────────────────────────────────────────

  /** Cobro rápido: el modal abre en efectivo con un solo campo. */
  async cobroRapido(page) {
    if (!(await ACCIONES.cargarCarrito(page))) return;
    await page.locator('button[title^="Cobrar"]').click();
    await page.getByText(/Total a pagar/).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
  },

  /** El mismo cobro repartido a mano entre varias formas de pago. */
  async cobroMixto(page) {
    await ACCIONES.cobroRapido(page);
    await page.getByRole("button", { name: /Pago mixto/i }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("Efectivo").fill("50");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Completar" }).nth(1).click();
    await page.waitForTimeout(700);
  },

  /** Cobro en dólares: se capturan los billetes y el sistema calcula el cambio. */
  async cobroDolares(page) {
    await ACCIONES.cobroRapido(page);
    await page.getByRole("button", { name: "Dólares", exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Dólares recibidos del cliente/i).fill("20").catch(async () => {
      await page.locator('input[type="number"]').first().fill("20");
    });
    await page.waitForTimeout(900);
  },

  /** Tarjeta de vales ya conocida: el sistema la identifica sola por su BIN. */
  async valesReconocida(page) {
    await ACCIONES.cobroRapido(page);
    await page.getByRole("button", { name: "Vales", exact: true }).click();
    await page.waitForTimeout(500);
    const lector = page.getByPlaceholder(/Pasa la tarjeta/i);
    await lector.fill(";5036129999887766=25121010000000000000?");
    await lector.press("Enter");
    await page.getByText(/identificada por BIN/i).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
  },

  /** Tarjeta nueva: se pregunta el emisor una sola vez. */
  async valesNueva(page) {
    await ACCIONES.cobroRapido(page);
    await page.getByRole("button", { name: "Vales", exact: true }).click();
    await page.waitForTimeout(500);
    const lector = page.getByPlaceholder(/Pasa la tarjeta/i);
    // BIN que no está en la tabla de aprendizaje: dispara la pregunta.
    await lector.fill(";4915330000445566=25121010000000000000?");
    await lector.press("Enter");
    await page.getByText(/Tarjeta nueva/i).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
  },

  /** Pestaña de roles con las tarjetas de cada perfil. */
  async verRoles(page) {
    await page.getByRole("button", { name: /^Roles \(/ }).click();
    await page.waitForTimeout(900);
  },

  /** Editor de un rol con sus permisos en casillas. */
  async editarRol(page) {
    await ACCIONES.verRoles(page);
    await page.getByText("Encargado de turno").first().click();
    await page.getByText(/Permisos \(/i).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(900);
  },

  /** Alta de usuario con la asignación de sucursal y rol. */
  async altaUsuario(page) {
    await page.getByRole("button", { name: /Nuevo usuario/i }).click();
    await page.getByText(/Tipo de usuario/i).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
  },

  /** Baja a la tarjeta de alertas automáticas de pedidos atrasados. */
  async verAlertas(page) {
    await page.getByText(/Alertas de pedidos atrasados/i).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  },

  /** Baja al bloque de reglas de pagos en dólares. */
  async verReglasDolares(page) {
    await page.getByText(/Pagos en dólares/i).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  },

  // ── Semana 9 ────────────────────────────────────────────────────────

  /** Producto SIN existencia en el carrito: el POS avisa pero deja cobrar. */
  async carritoSinExistencia(page) {
    // Se busca en el catálogo un producto activo cuya existencia sea cero, que
    // es justo el caso que antes bloqueaba la venta.
    const agotado = await page.evaluate(async () => {
      const res = await fetch("/api/productos");
      if (!res.ok) return null;
      const productos = await res.json();
      const sinStock = productos.find((p) => (p.existenciaMatriz ?? 0) <= 0 && !p.requierePesaje);
      return sinStock ? sinStock.nombre : null;
    });
    if (!agotado) return;

    const termino = agotado.split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/).find((t) => t.length >= 4) ?? agotado;
    await page.getByPlaceholder(/Buscar por nombre o SKU/i).fill(termino);
    const opcion = page.locator("div.absolute.z-10 button").first();
    await opcion.waitFor({ timeout: 8000 });
    await opcion.click();
    await page.waitForTimeout(900);
  },

  /** Cobro con tarjeta: se ve el selector de crédito / débito / American Express. */
  async cobroTarjetaTipo(page) {
    if (!(await ACCIONES.cargarCarrito(page))) return;
    await page.locator('button[title^="Cobrar"]').click();
    await page.getByText(/Total a pagar/).first().waitFor({ timeout: 8000 });
    await page.getByRole("button", { name: "Tarjeta", exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Débito", exact: true }).click();
    await page.waitForTimeout(700);
  },

  /** Lista de atajos de teclado del punto de venta. */
  async verAtajos(page) {
    await page.getByRole("button", { name: /Ver los atajos de teclado/i }).click();
    await page.getByText(/Atajos del punto de venta/i).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
  },

  /** F2: consulta de precio con la opción de pasar el producto al carrito. */
  async consultaPrecioF2(page) {
    await page.keyboard.press("F2");
    await page.getByText(/Consultar precio/i).first().waitFor({ timeout: 8000 });

    // Se consulta un SKU real del catálogo para que la ficha traiga datos.
    const sku = await page.evaluate(async () => {
      const res = await fetch("/api/productos");
      if (!res.ok) return "";
      const productos = await res.json();
      return productos[0]?.sku ?? "";
    });
    if (!sku) return;

    // El POS tiene su propio lector con un placeholder parecido; se acota al
    // campo que vive dentro del modal de consulta.
    await page.getByPlaceholder("Escanea o escribe el código del producto").fill(sku);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.waitForTimeout(900);
  },

  /** Retiro de efectivo con la opción de autorizar con el NIP del encargado. */
  async retiroConNip(page) {
    await page.keyboard.press("F6");
    await page.getByText(/Retirar efectivo/i).first().waitFor({ timeout: 8000 });
    await page.getByRole("button", { name: /Con NIP del encargado/i }).click();
    await page.waitForTimeout(700);
  },

  /**
   * Campo de un formulario a partir del texto de su etiqueta.
   *
   * `FormField` pinta la etiqueta como hermana del control, no envolviéndolo,
   * así que `getByLabel` no los relaciona: se sube al contenedor y de ahí se
   * baja al input.
   */
  campoPorEtiqueta(page, etiqueta) {
    return page
      .locator("label", { hasText: etiqueta })
      .first()
      .locator("xpath=..")
      .locator("input")
      .first();
  },

  /** Deja el bloque pegado a la parte de arriba de la ventana. */
  async llevarArriba(page, texto) {
    await page
      .getByText(texto)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.waitForTimeout(500);
  },

  /**
   * Topes de dólares con valores de ejemplo escritos en el formulario.
   * NO se guarda: solo se llenan los campos para que la captura muestre cómo
   * queda la política, sin tocar la configuración real de la tienda.
   */
  async topesDolares(page) {
    await ACCIONES.llevarArriba(page, /Límite de aceptación de dólares/i);
    await ACCIONES.campoPorEtiqueta(page, /Porcentaje máximo del total de la venta/i)
      .fill("40")
      .catch(() => {});
    await ACCIONES.campoPorEtiqueta(page, /Monto máximo en dólares por venta/i)
      .fill("200")
      .catch(() => {});
    await page.waitForTimeout(800);
  },

  /** Bloque del aviso a compras por producto agotado. */
  async avisoCompras(page) {
    await ACCIONES.llevarArriba(page, /Aviso a compras por producto agotado/i);
    await page.waitForTimeout(400);
  },

  /** Tarjeta del NIP con el que se autoriza crear encargados de turno. */
  async nipCrearSupervisores(page) {
    await ACCIONES.llevarArriba(page, /NIP para crear supervisores/i);
    await page.waitForTimeout(400);
  },

  /** Tipo de cambio con el sello de quién lo actualizó y cuándo. */
  async tipoCambioSellado(page) {
    await ACCIONES.llevarArriba(page, /Días y horario laborales/i);
    await page.waitForTimeout(400);
  },

  /** Alta de usuario con rol de encargado de turno: se piden los dos NIP. */
  async altaEncargado(page) {
    await page.getByRole("button", { name: /Nuevo usuario/i }).click();
    await page.getByText(/Tipo de usuario/i).first().waitFor({ timeout: 8000 });

    const selectRol = page.locator("select").filter({ hasText: /Perfil heredado/ }).first();
    await selectRol.selectOption({ label: "Encargado de turno" }).catch(() => {});
    await page.waitForTimeout(900);
  },

  /** Buscador del menú: se teclea "punto" y el menú se reduce a esa entrada. */
  async buscadorMenu(page) {
    const buscador = page.getByPlaceholder(/Buscar en el menú/i);
    await buscador.fill("punto");
    await page.waitForTimeout(700);
  },

  /** Alta de sucursal: el usuario de acceso quedó como opcional. */
  async altaSucursal(page) {
    await page.getByRole("button", { name: /Nueva sucursal/i }).click();
    await page.getByText(/Usuario de acceso de la sucursal/i).first().waitFor({ timeout: 8000 });
    await page.getByLabel(/Nombre de la sucursal/i).fill("Sucursal Otay").catch(() => {});
    await page.waitForTimeout(700);
  },

  /** Devolución buscada con el número pelón, sin el prefijo VTA-. */
  async devolucionPorNumero(page) {
    // Se toma el folio de una venta REAL DEL MOSTRADOR (las de otras sucursales
    // no se pueden devolver aquí) y se teclea solo su número, sin el "VTA-".
    const numero = await page.evaluate(async () => {
      const res = await fetch("/api/ventas");
      if (!res.ok) return "";
      const ventas = await res.json();
      const propia = ventas.find(
        (v) => /matriz/i.test(v?.sucursalId?.nombre ?? "") && v.estado === "completada"
      );
      const digitos = String(propia?.folio ?? "").match(/(\d+)$/);
      return digitos ? String(Number(digitos[1])) : "";
    });
    if (!numero) return;

    await page.getByPlaceholder(/Número de folio/i).fill(numero);
    await page.getByRole("button", { name: /Buscar venta/i }).click();
    await page.waitForTimeout(1500);
  },

  /** Marca la casilla que deja el protocolo de notas de venta sin fecha de fin. */
  async activacionIndefinida(page) {
    const casilla = page.locator("label", { hasText: /Indefinido/ }).locator('input[type="checkbox"]');
    await casilla.check();
    await page.waitForTimeout(600);
    await page.getByText("Activar protocolo").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
};

/** Pantallas a capturar: [archivo, ruta, cuenta, accion?, semana] */
const PANTALLAS = [
  ["matriz-dashboard", "/matriz", "matriz", null, 5],
  ["matriz-configuracion", "/matriz/configuracion", "matriz", null, 5],
  ["matriz-sucursales", "/matriz/sucursales", "matriz", null, 5],
  ["matriz-sucursal-zona-horaria", "/matriz/sucursales", "matriz", "abrirModalSucursal", 5],
  ["matriz-cortes", "/matriz/cortes", "matriz", null, 5],
  ["matriz-notas-de-venta", "/matriz/notas-de-venta", "matriz", null, 5],
  ["sucursal-punto-venta", "/sucursal", "sucursal", null, 5],
  ["sucursal-punto-venta-cobro", "/sucursal", "sucursal", "cobroConCredito", 5],
  ["sucursal-clientes", "/sucursal/clientes", "sucursal", null, 5],
  ["sucursal-cliente-alta", "/sucursal/clientes", "sucursal", "altaCliente", 5],
  ["sucursal-devoluciones", "/sucursal/devoluciones", "sucursal", null, 5],
  ["sucursal-prestamos", "/sucursal/prestamos", "sucursal", null, 5],
  ["sucursal-prestamos-stock", "/sucursal/prestamos", "sucursal", "buscarStockOtrasSucursales", 5],
  ["sucursal-prestamos-solicitar", "/sucursal/prestamos", "sucursal", "pedirPrestado", 5],
  ["sucursal-ventas", "/sucursal/ventas", "sucursal", null, 5],

  ["s6-matriz-pos", "/matriz/mostrador", "matriz", null, 6],
  ["s6-reporte-ventas", "/matriz/reportes/ventas", "matriz", null, 6],
  ["s6-facturas-bandeja", "/matriz/facturas", "matriz", null, 6],
  ["s6-facturas-modal", "/matriz/facturas", "matriz", "abrirModalFactura", 6],
  ["s6-facturas-emitidas", "/matriz/facturas", "matriz", "verFacturasEmitidas", 6],
  ["s6-cancelaciones", "/matriz/cancelaciones", "matriz", null, 6],
  ["s6-configuracion-nip", "/matriz/configuracion", "matriz", "verNipSupervisor", 6],
  ["s6-notas-de-venta", "/matriz/notas-de-venta", "matriz", null, 6],
  ["s6-menu-contraido", "/matriz/facturas", "matriz", "contraerMenu", 6],
  ["s6-pos-cancelacion", "/sucursal", "sucursal", "cancelacionEnPuntoVenta", 6],
  ["s6-cliente-constancia", "/sucursal/clientes", "sucursal", "altaClienteConstancia", 6],

  ["s7-motivos-configuracion", "/matriz/configuracion", "matriz", "verMotivosConfigurados", 7],
  ["s7-notas-indefinido", "/matriz/notas-de-venta", "matriz", "activacionIndefinida", 7],
  ["s7-pos-formas-pago", "/sucursal", "sucursal", "formasDePago", 7],
  ["s7-pos-vales", "/sucursal", "sucursal", "cobroConVales", 7],
  ["s7-pos-motivo-cancelacion", "/sucursal", "sucursal", "motivoDeCancelacion", 7],
  ["s7-pos-motivo-otro", "/sucursal", "sucursal", "motivoOtro", 7],
  ["s7-cliente-constancia", "/sucursal/clientes", "sucursal", "altaClienteConstancia", 7],

  ["s8-matriz-usuarios", "/matriz/usuarios", "matriz", null, 8],
  ["s8-matriz-usuario-alta", "/matriz/usuarios", "matriz", "altaUsuario", 8],
  ["s8-matriz-roles", "/matriz/usuarios", "matriz", "verRoles", 8],
  ["s8-matriz-rol-permisos", "/matriz/usuarios", "matriz", "editarRol", 8],
  ["s8-matriz-terminales", "/matriz/terminales", "matriz", null, 8],
  ["s8-matriz-vales", "/matriz/vales", "matriz", null, 8],
  ["s8-matriz-bitacora", "/matriz/bitacora", "matriz", null, 8],
  ["s8-configuracion-alertas", "/matriz/configuracion", "matriz", "verAlertas", 8],
  ["s8-configuracion-dolares", "/matriz/configuracion", "matriz", "verReglasDolares", 8],
  ["s8-pos-cobro-rapido", "/sucursal", "sucursal", "cobroRapido", 8],
  ["s8-pos-cobro-mixto", "/sucursal", "sucursal", "cobroMixto", 8],
  ["s8-pos-dolares", "/sucursal", "sucursal", "cobroDolares", 8],
  ["s8-pos-vales-reconocida", "/sucursal", "sucursal", "valesReconocida", 8],
  ["s8-pos-vales-nueva", "/sucursal", "sucursal", "valesNueva", 8],

  // Semana 9. Todas se toman con la cuenta de matriz: el mostrador de matriz es
  // el mismo punto de venta que el de una sucursal, así que no hace falta una
  // segunda cuenta para ilustrarlo.
  ["s9-pos-tipo-tarjeta", "/matriz/mostrador", "matriz", "cobroTarjetaTipo", 9],
  ["s9-pos-sin-stock", "/matriz/mostrador", "matriz", "carritoSinExistencia", 9],
  ["s9-pos-atajos", "/matriz/mostrador", "matriz", "verAtajos", 9],
  ["s9-pos-precio-f2", "/matriz/mostrador", "matriz", "consultaPrecioF2", 9],
  ["s9-pos-retiro-nip", "/matriz/mostrador", "matriz", "retiroConNip", 9],
  ["s9-config-tipo-cambio", "/matriz/configuracion", "matriz", "tipoCambioSellado", 9],
  ["s9-config-topes-dolares", "/matriz/configuracion", "matriz", "topesDolares", 9],
  ["s9-config-compras", "/matriz/configuracion", "matriz", "avisoCompras", 9],
  ["s9-config-nip-supervisores", "/matriz/configuracion", "matriz", "nipCrearSupervisores", 9],
  ["s9-usuarios-encargado", "/matriz/usuarios", "matriz", "altaEncargado", 9],
  ["s9-menu-buscador", "/matriz/productos", "matriz", "buscadorMenu", 9],
  ["s9-bitacora", "/matriz/bitacora", "matriz", null, 9],
  ["s9-dashboard-agotados", "/matriz", "matriz", null, 9],
  ["s9-sucursal-alta", "/matriz/sucursales", "matriz", "altaSucursal", 9],
  ["s9-devolucion-folio", "/matriz/mostrador/devoluciones", "matriz", "devolucionPorNumero", 9],
];

/** --semana=6 limita la corrida a esa entrega y deja intacto el histórico. */
function semanaSolicitada() {
  const arg = process.argv.find((a) => a.startsWith("--semana="));
  return arg ? Number(arg.split("=")[1]) : null;
}

async function iniciarSesion(page, cuenta) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // Los inputs son controlados por React: si se llenan antes de que hidrate, la
  // hidratación los vuelve a vaciar y el submit se queda sin datos.
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');

  await email.fill(cuenta.email);
  await password.fill(cuenta.password);

  // Verifica que React ya tomó los valores antes de enviar.
  if ((await email.inputValue()) !== cuenta.email) {
    await page.waitForTimeout(1500);
    await email.fill(cuenta.email);
    await password.fill(cuenta.password);
  }

  const respuesta = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
    { timeout: 20000 }
  );
  await page.click('button[type="submit"]');

  const res = await respuesta;
  if (!res.ok()) throw new Error(`el login respondió ${res.status()}`);

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

/**
 * Varias pantallas piden sus datos desde el cliente después de montar, así que
 * `networkidle` puede alcanzarse antes de que llegue la tabla. Se espera además
 * a que desaparezcan los "Cargando..." para no fotografiar la pantalla vacía.
 */
async function esperarDatos(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page
    .locator("text=/^Cargando\\.\\.\\.$/")
    .first()
    .waitFor({ state: "detached", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

async function capturar(page, archivo, ruta, accion) {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded" });
  await esperarDatos(page);
  await ocultarOverlayDev(page);

  if (accion) {
    try {
      await ACCIONES[accion](page);
    } catch (error) {
      console.log(`    (acción "${accion}" incompleta: ${error.message.split("\n")[0]})`);
    }
  }

  await esperarDatos(page);
  await ocultarOverlayDev(page);
  await page.screenshot({ path: `${SALIDA}/${archivo}.png`, fullPage: false });
  console.log(`  ✓ ${archivo}.png`);
}

async function main() {
  await mkdir(SALIDA, { recursive: true });

  const semana = semanaSolicitada();
  if (semana) console.log(`Capturando solo la semana ${semana}.`);

  const navegador = await chromium.launch();
  const resultados = { ok: [], fallidas: [] };

  for (const rol of ["matriz", "sucursal"]) {
    const cuenta = CUENTAS[rol];
    const pantallas = PANTALLAS.filter(
      ([, , r, , s]) => r === rol && (semana === null || s === semana)
    );
    if (pantallas.length === 0) continue;

    if (!cuenta.email || !cuenta.password) {
      console.log(`\n⚠ Sin credenciales de ${rol}; se omiten ${pantallas.length} pantallas.`);
      resultados.fallidas.push(...pantallas.map(([a]) => `${a} (sin credenciales)`));
      continue;
    }

    const contexto = await navegador.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "es-MX",
    });
    const page = await contexto.newPage();

    try {
      console.log(`\nEntrando como ${rol} (${cuenta.email})...`);
      await iniciarSesion(page, cuenta);
      console.log("  sesión iniciada");
    } catch (error) {
      console.log(`  ✗ no se pudo entrar como ${rol}: ${error.message.split("\n")[0]}`);
      resultados.fallidas.push(...pantallas.map(([a]) => `${a} (login falló)`));
      await contexto.close();
      continue;
    }

    for (const [archivo, ruta, , accion] of pantallas) {
      // Cada captura arranca de cero: si la anterior dejó un modal abierto o el
      // menú contraído, la siguiente saldría contaminada.
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
      try {
        await capturar(page, archivo, ruta, accion);
        resultados.ok.push(archivo);
      } catch (error) {
        console.log(`  ✗ ${archivo}: ${error.message.split("\n")[0]}`);
        resultados.fallidas.push(archivo);
      }
    }

    await contexto.close();
  }

  await navegador.close();

  console.log(`\nCapturas generadas: ${resultados.ok.length}`);
  if (resultados.fallidas.length > 0) {
    console.log(`No se pudieron capturar: ${resultados.fallidas.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
