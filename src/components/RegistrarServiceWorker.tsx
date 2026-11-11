"use client";

import { useEffect } from "react";

// Registra public/sw.js: con él la app se puede instalar en la PC y abre aunque
// no haya internet. En desarrollo no se registra para no servir código viejo.
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((registro) => {
        // Lo que ya se descargó antes de que el service worker tomara control
        // (JS, CSS, fuentes) y la página actual, para que abran sin internet
        // desde la primera visita.
        const archivos = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin + "/_next/static/") || u.startsWith(location.origin + "/media/"));
        registro.active?.postMessage({ tipo: "titos:precargar", pagina: location.pathname, archivos });
      })
      .catch(() => {
        // Sin service worker la app funciona igual, solo no abre sin conexión.
      });
  }, []);
  return null;
}

/** Borra las páginas guardadas para uso sin internet (al cerrar sesión). */
export function olvidarPaginasGuardadas() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage("titos:cerrar-sesion");
}
