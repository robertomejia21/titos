// Service worker de Titos: hace que la app abra aunque no haya internet.
//
// - Páginas (navegación): primero la red; si no hay conexión, la última copia
//   guardada de esa página. Si nunca se abrió, la del punto de venta
//   (/sucursal) o la de matriz.
// - Archivos de la app (/_next/static, /media, fuentes): se guardan la primera
//   vez y se sirven desde la caché (sus nombres cambian en cada versión).
// - /api: nunca se toca. Sin conexión, el punto de venta ya usa sus datos en
//   localStorage y encola las ventas (src/lib/offlinePos.ts).
//
// Al cambiar la estrategia, sube VERSION para descartar las cachés viejas.

const VERSION = "v1";
const CACHE_PAGINAS = `titos-paginas-${VERSION}`;
const CACHE_ESTATICOS = `titos-estaticos-${VERSION}`;
const RESPALDOS = ["/sucursal", "/matriz"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const vigentes = [CACHE_PAGINAS, CACHE_ESTATICOS];
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n.startsWith("titos-") && !vigentes.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// Al cerrar sesión se borran las páginas guardadas: traen el nombre y la
// sucursal de quien estaba dentro.
self.addEventListener("message", (event) => {
  if (event.data === "titos:cerrar-sesion") {
    event.waitUntil(caches.delete(CACHE_PAGINAS));
    return;
  }
  // La primera visita se descarga antes de que este service worker controle la
  // página; la app manda lo que ya cargó para guardarlo desde ese momento.
  if (event.data && event.data.tipo === "titos:precargar") {
    event.waitUntil(precargar(event.data));
  }
});

async function precargar({ pagina, archivos }) {
  const estaticos = await caches.open(CACHE_ESTATICOS);
  await Promise.all(
    (archivos || []).map(async (ruta) => {
      try {
        const url = new URL(ruta, self.location.origin);
        if (url.origin !== self.location.origin || !esEstatico(url)) return;
        if (await estaticos.match(url.href)) return;
        const r = await fetch(url.href);
        if (r.ok) await estaticos.put(url.href, r);
      } catch {}
    })
  );
  if (typeof pagina === "string" && /^\/(sucursal|matriz)(\/|$)/.test(pagina)) {
    try {
      await navegacion(new Request(new URL(pagina, self.location.origin).href, { credentials: "include" }), new URL(pagina, self.location.origin));
    } catch {}
  }
}

function esEstatico(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/media/") || /\.(?:woff2?|ttf|png|svg|ico|jpg|webp)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(navegacion(request, url));
    return;
  }

  if (esEstatico(url)) {
    event.respondWith(estatico(request));
  }
});

async function navegacion(request, url) {
  const cache = await caches.open(CACHE_PAGINAS);
  try {
    const respuesta = await fetch(request);
    // Solo se guardan páginas reales de la app: no el login ni lo que terminó
    // redirigiendo a él (sesión vencida).
    const final = new URL(respuesta.url || request.url);
    if (respuesta.ok && /^\/(sucursal|matriz)(\/|$)/.test(final.pathname)) {
      const copia = await copiaLimpia(respuesta.clone());
      await cache.put(final.pathname, copia);
    }
    return respuesta;
  } catch {
    const guardada = (await cache.match(url.pathname)) || (await primerRespaldo(cache));
    if (guardada) return guardada;
    return new Response(PAGINA_SIN_CONEXION, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function primerRespaldo(cache) {
  for (const ruta of RESPALDOS) {
    const r = await cache.match(ruta);
    if (r) return r;
  }
  return null;
}

// Una respuesta que vino de una redirección no puede servirse a una
// navegación; se guarda una copia "limpia" con el mismo contenido.
async function copiaLimpia(respuesta) {
  const cuerpo = await respuesta.blob();
  return new Response(cuerpo, { status: 200, headers: respuesta.headers });
}

async function estatico(request) {
  const cache = await caches.open(CACHE_ESTATICOS);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta.ok) cache.put(request, respuesta.clone());
  return respuesta;
}

const PAGINA_SIN_CONEXION = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Titos · Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f6f4;color:#1b1b1b}main{max-width:26rem;padding:2rem;text-align:center}h1{color:#1e7a34;font-size:1.3rem}button{margin-top:1rem;background:#1e7a34;color:#fff;border:0;border-radius:.5rem;padding:.6rem 1.2rem;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>Sin conexión a internet</h1><p>Esta pantalla todavía no se ha abierto en esta computadora con internet, así que no está guardada.</p><p>Abre el punto de venta al menos una vez con internet para que quede disponible sin conexión.</p><button onclick="location.reload()">Reintentar</button></main></body></html>`;
