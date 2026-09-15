// Validación de una página de la presentación: DOM bien formado, imágenes
// presentes, pestañas emparejadas y anclas del menú vivas.
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";

const archivo = process.argv[2];
const html = readFileSync(archivo, "utf8");
const { document } = new JSDOM(html).window;
const base = "public/presentacion/";
const fallos = [];

// Si el DOM reconstruido pierde secciones, el HTML venía mal anidado.
const secciones = [...document.querySelectorAll("section")];
console.log(`secciones: ${secciones.length}`);
console.log(`tarjetas: ${document.querySelectorAll("article.tarjeta").length}`);
console.log(`visores: ${document.querySelectorAll("[data-visor]").length}`);

// El visor grande (lightbox) nace sin src: lo llena el script al abrirlo.
const imgs = [...document.querySelectorAll("img[src]")];
for (const img of imgs) {
  const src = img.getAttribute("src");
  if (!existsSync(base + src)) fallos.push(`imagen faltante: ${src}`);
  if (!img.getAttribute("alt")?.trim()) fallos.push(`imagen sin alt: ${src}`);
}
console.log(`imágenes: ${imgs.length}`);

for (const visor of document.querySelectorAll("[data-visor]")) {
  const paneles = [...visor.querySelectorAll("[data-panel]")].map((p) => p.dataset.panel);
  const visibles = visor.querySelectorAll(".lamina.visible").length;
  if (visibles !== 1) fallos.push(`visor con ${visibles} láminas visibles al abrir`);

  // Un visor de una sola lámina va sin barra de pestañas, a propósito.
  if (!visor.querySelector(".pestanas")) {
    if (paneles.length !== 1) fallos.push(`visor sin pestañas pero con ${paneles.length} láminas`);
    continue;
  }
  const tabs = [...visor.querySelectorAll("[data-tab]")].map((b) => b.dataset.tab);
  for (const t of tabs) if (!paneles.includes(t)) fallos.push(`pestaña sin lámina: ${t}`);
  for (const p of paneles) if (!tabs.includes(p)) fallos.push(`lámina sin pestaña: ${p}`);
  const activos = [...visor.querySelectorAll('[aria-selected="true"]')].length;
  if (activos !== 1) fallos.push(`visor con ${activos} pestañas marcadas como activas`);
}

for (const a of document.querySelectorAll(".nav-links a")) {
  const id = a.getAttribute("href").slice(1);
  if (!document.getElementById(id)) fallos.push(`ancla rota en el menú: #${id}`);
}

for (const a of document.querySelectorAll(".semanas a[href$='.html'], .boton-semana")) {
  const destino = a.getAttribute("href");
  if (!existsSync(base + destino)) fallos.push(`enlace de semana roto: ${destino}`);
}

console.log(fallos.length ? `\nPROBLEMAS:\n  ${fallos.join("\n  ")}` : "\nSin problemas.");
process.exit(fallos.length ? 1 : 0);
