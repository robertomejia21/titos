import type { MetadataRoute } from "next";

// Permite instalar el sistema como app de PC (Chrome/Edge → "Instalar Titos"):
// abre en su propia ventana, sin barra de dirección. El modo sin internet lo da
// public/sw.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Titos | Almacén Central",
    short_name: "Titos",
    description: "Punto de venta y almacén de Mercados Titos",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e7a34",
    lang: "es",
    icons: [
      { src: "/media/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/media/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/media/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
