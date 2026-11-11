import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // pdfjs carga su worker con un import dinámico relativo a su propio archivo.
  // Si el bundler lo mete en un chunk de vendor, esa ruta deja de existir y la
  // lectura de la constancia fiscal truena con "Setting up fake worker failed".
  // Dejándolo externo, Node lo resuelve desde node_modules y sí encuentra el worker.
  serverExternalPackages: ["pdfjs-dist"],
  // El service worker (modo sin internet / app instalable) no debe quedarse en
  // caché del navegador: así cada despliegue llega a las cajas.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
