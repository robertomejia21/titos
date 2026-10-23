// Datos iniciales de la operación del CEDIS (minuta del 21 de octubre de 2026).
//
// Todo es un punto de partida razonable para ajustar después desde las
// pantallas: prioridad de tiendas, unidades, rutas con responsables, mínimos de
// productos clave en cajas y vida útil de perecederos. Los choferes son de
// ejemplo (llevan "(ejemplo)" en el nombre) hasta que se capturen los reales.
//
// Es idempotente y conservador: no duplica unidades, rutas ni choferes por
// nombre, y solo llena lo que no se ha configurado con el sistema nuevo. Sin
// --aplicar solo muestra lo que haría.
//
//   npx tsx --env-file=.env.local scripts/seed-operacion-cedis.ts            (vista previa)
//   npx tsx --env-file=.env.local scripts/seed-operacion-cedis.ts --aplicar  (escribe)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import Sucursal from "../src/models/Sucursal";
import Empleado from "../src/models/Empleado";
import Producto from "../src/models/Producto";
import Vehiculo from "../src/models/Vehiculo";
import Ruta from "../src/models/Ruta";
import { obtenerConfiguracionOperacion } from "../src/lib/operacion";

const APLICAR = process.argv.includes("--aplicar");
const cambios: string[] = [];
const respaldo: Record<string, unknown>[] = [];
const anotar = (texto: string) => cambios.push(texto);

// ---------------------------------------------------------------------------
// Prioridad entre tiendas: Home Chef primero (es servicio a domicilio con hora
// comprometida), luego las de más venta y al final las que reciben segunda
// vuelta con más holgura.
const PRIORIDAD = [/home ?chef/i, /glorieta/i, /xochimilco/i, /santa m[oó]nica/i, /\bjr\b|junior/i, /alcal[aá]/i, /coronado/i, /progreso/i];

const VEHICULOS = [
  { nombre: "Estaquita 1", tipo: "estaquita", refrigerado: true, notas: "Refrigerada. Preferente para Home Chef." },
  { nombre: "Estaquita 2", tipo: "estaquita", refrigerado: true, notas: "Refrigerada." },
  { nombre: "Estaquita 3", tipo: "estaquita", refrigerado: false, notas: "Seca: abarrotes y segundas vueltas." },
  { nombre: "Troque Grande (Forte)", tipo: "camion", refrigerado: false, notas: "Ruta larga y reciclaje de los jueves." },
];

const CHOFERES_EJEMPLO = ["Chofer A (ejemplo)", "Chofer B (ejemplo)", "Chofer C (ejemplo)", "Chofer D (ejemplo)"];

type ParadaSeed = { tienda?: RegExp; tipo?: "recoleccion" | "basura" | "otro"; descripcion?: string };
const RUTAS: {
  nombre: string;
  tipo: "primera_vuelta" | "segunda_vuelta" | "especial";
  horaSalida: string;
  duracionMin: number;
  requiereRefrigerado?: boolean;
  diasSemana?: string[];
  vehiculo: string;
  responsable: string;
  sustituto?: string;
  paradas: ParadaSeed[];
  notas?: string;
  orden: number;
}[] = [
  {
    nombre: "Home Chef",
    tipo: "primera_vuelta",
    horaSalida: "06:30",
    duracionMin: 120,
    requiereRefrigerado: true,
    vehiculo: "Estaquita 1",
    responsable: "Chofer A (ejemplo)",
    sustituto: "Chofer D (ejemplo)",
    paradas: [{ tienda: /home ?chef/i }],
    notas: "Primera salida del día.",
    orden: 1,
  },
  {
    nombre: "Troque Grande",
    tipo: "primera_vuelta",
    horaSalida: "07:00",
    duracionMin: 240,
    vehiculo: "Troque Grande (Forte)",
    responsable: "Chofer B (ejemplo)",
    sustituto: "Chofer C (ejemplo)",
    paradas: [
      { tienda: /xochimilco/i },
      { tienda: /santa m[oó]nica/i },
      { tienda: /glorieta/i },
      { tipo: "basura", descripcion: "Recoger cartón y caja plástica en Glorieta y llevarlo a Junior" },
      { tienda: /\bjr\b|junior/i },
    ],
    notas: "Empieza en Xochimilco y termina en Glorieta; la basura de Glorieta se controla en Junior.",
    orden: 2,
  },
  {
    nombre: "Alcalá · Coronado · Progreso",
    tipo: "primera_vuelta",
    horaSalida: "07:30",
    duracionMin: 180,
    requiereRefrigerado: true,
    vehiculo: "Estaquita 2",
    responsable: "Chofer C (ejemplo)",
    sustituto: "Chofer D (ejemplo)",
    paradas: [{ tienda: /alcal[aá]/i }, { tienda: /coronado/i }, { tienda: /progreso/i }],
    notas: "Lleva mariscos de Progreso: unidad refrigerada.",
    orden: 3,
  },
  {
    nombre: "Segunda vuelta 10:40",
    tipo: "segunda_vuelta",
    horaSalida: "10:40",
    duracionMin: 90,
    vehiculo: "Estaquita 3",
    responsable: "Chofer A (ejemplo)",
    paradas: [{ tienda: /\bjr\b|junior/i }, { tienda: /santa m[oó]nica/i }, { tienda: /xochimilco/i }],
    notas: "Sentido contrario a la primera: empieza en Junior. Retirar del cuarto frío lo separado y capturar traspasos.",
    orden: 4,
  },
  {
    nombre: "Segunda vuelta 11:30",
    tipo: "segunda_vuelta",
    horaSalida: "11:30",
    duracionMin: 90,
    vehiculo: "Estaquita 2",
    responsable: "Chofer C (ejemplo)",
    paradas: [{ tienda: /glorieta/i }, { tienda: /alcal[aá]/i }, { tienda: /coronado/i }],
    orden: 5,
  },
  {
    nombre: "Segunda vuelta 12:00",
    tipo: "segunda_vuelta",
    horaSalida: "12:00",
    duracionMin: 90,
    requiereRefrigerado: true,
    vehiculo: "Estaquita 1",
    responsable: "Chofer D (ejemplo)",
    paradas: [{ tienda: /home ?chef/i }, { tienda: /progreso/i }],
    orden: 6,
  },
  {
    nombre: "Reciclaje de cartón (jueves)",
    tipo: "especial",
    horaSalida: "14:00",
    duracionMin: 150,
    diasSemana: ["jueves"],
    vehiculo: "Troque Grande (Forte)",
    responsable: "Chofer B (ejemplo)",
    paradas: [
      { tipo: "recoleccion", descripcion: "Cargar el cartón juntado en Junior" },
      { tipo: "otro", descripcion: "Vender cartón por tonelada en la recicladora" },
      { tipo: "recoleccion", descripcion: "Recolectar cajas plásticas negras" },
    ],
    notas: "Se llena el camión grande con el cartón de la semana.",
    orden: 7,
  },
];

// Productos clave: mínimos y máximos en cajas, unidades por caja y vida útil.
// Para frutas y verduras en kg, "unidades por caja" son los kg que trae la caja.
const CLAVE: { sku: string; porCaja: number; minCajas: number; maxCajas: number; tarima?: number; vida?: number }[] = [
  // Abarrotes del esquema de surtido parcial (mayonesa, aceite, mostaza)
  { sku: "7501005148849", porCaja: 12, minCajas: 8, maxCajas: 20, tarima: 60 }, // Mayonesa Best Food 500 ml
  { sku: "7501005148948", porCaja: 12, minCajas: 4, maxCajas: 10, tarima: 50 }, // Mayonesa Best Food 946 g
  { sku: "7501048100163", porCaja: 12, minCajas: 10, maxCajas: 25, tarima: 70 }, // Aceite Cristal 1 L
  { sku: "7501048100200", porCaja: 24, minCajas: 4, maxCajas: 10, tarima: 60 }, // Aceite Cristal 500 ml
  { sku: "7501003335029", porCaja: 24, minCajas: 3, maxCajas: 8 }, // Mostaza McCormick 210 g
  { sku: "041500750903", porCaja: 12, minCajas: 2, maxCajas: 6 }, // Mostaza French's 226 g
  { sku: "762", porCaja: 12, minCajas: 5, maxCajas: 15, vida: 21 }, // Huevo grande cartera c/30
  // Frutas y verduras
  { sku: "1", porCaja: 10, minCajas: 6, maxCajas: 15, vida: 5 }, // Aguacate
  { sku: "143", porCaja: 18, minCajas: 2, maxCajas: 4, vida: 5 }, // Plátano dominico (4 días a 1 semana)
  { sku: "69", porCaja: 18, minCajas: 3, maxCajas: 8, vida: 6 }, // Plátano
  { sku: "83", porCaja: 12, minCajas: 6, maxCajas: 15, vida: 6 }, // Tomate bola
  { sku: "124", porCaja: 12, minCajas: 6, maxCajas: 15, vida: 6 }, // Tomate saladete
  { sku: "50", porCaja: 18, minCajas: 3, maxCajas: 8, vida: 12 }, // Limón verde
  { sku: "15", porCaja: 25, minCajas: 4, maxCajas: 10, vida: 21 }, // Cebolla blanca
  { sku: "76", porCaja: 25, minCajas: 3, maxCajas: 8, vida: 21 }, // Papa blanca
  { sku: "57", porCaja: 15, minCajas: 3, maxCajas: 8, vida: 6 }, // Melón
  { sku: "37", porCaja: 8, minCajas: 4, maxCajas: 10, vida: 3 }, // Fresa canasta chica
  { sku: "394", porCaja: 6, minCajas: 3, maxCajas: 8, vida: 3 }, // Fresa canasta grande
  { sku: "49", porCaja: 24, minCajas: 2, maxCajas: 5, vida: 5 }, // Lechuga bola
  { sku: "9", porCaja: 9, minCajas: 2, maxCajas: 5, vida: 5 }, // Brócoli
  { sku: "26", porCaja: 10, minCajas: 2, maxCajas: 5, vida: 10 }, // Chile jalapeño
  { sku: "33", porCaja: 10, minCajas: 2, maxCajas: 5, vida: 8 }, // Chile serrano
];

/** Vida útil por línea para el resto de los perecederos que no tienen una propia. */
const VIDA_POR_LINEA: { linea: string; unidad?: "kg" | "pieza"; dias: number }[] = [
  { linea: "FRUTAS Y VERDURAS", unidad: "kg", dias: 7 },
  { linea: "MARISCOS FRESCO (PROGRESO)", dias: 2 },
];

async function main() {
  await connectDB();
  console.log(APLICAR ? "Aplicando cambios…\n" : "VISTA PREVIA (nada se escribe; usa --aplicar)\n");

  // ---------- Reglas ----------
  const config = await obtenerConfiguracionOperacion();
  const sucursales = await Sucursal.find({ activo: true, esMatriz: { $ne: true } }).select("nombre").lean();
  if (!config.prioridadSucursales?.length) {
    const ordenadas = [
      ...PRIORIDAD.map((re) => sucursales.find((s) => re.test(s.nombre))).filter((s): s is (typeof sucursales)[number] => !!s),
    ];
    for (const s of sucursales) if (!ordenadas.includes(s)) ordenadas.push(s);
    anotar(`Prioridad de tiendas: ${ordenadas.map((s, i) => `${i + 1}. ${s.nombre}`).join(", ")}`);
    if (APLICAR) {
      config.prioridadSucursales = ordenadas.map((s, i) => ({ sucursalId: s._id, prioridad: i + 1 }));
      config.criterioProrrateo = "caja_completa";
      await config.save();
    }
  } else anotar("Prioridad de tiendas: ya estaba capturada, no se toca");

  // ---------- Unidades ----------
  const vehiculoId = new Map<string, unknown>();
  for (const v of VEHICULOS) {
    const existente = await Vehiculo.findOne({ nombre: v.nombre }).lean();
    if (existente) {
      vehiculoId.set(v.nombre, existente._id);
      continue;
    }
    anotar(`Unidad nueva: ${v.nombre}${v.refrigerado ? " (refrigerada)" : ""}`);
    if (APLICAR) vehiculoId.set(v.nombre, (await Vehiculo.create(v))._id);
  }

  // ---------- Choferes de ejemplo ----------
  const choferId = new Map<string, unknown>();
  for (const nombre of CHOFERES_EJEMPLO) {
    const existente = await Empleado.findOne({ nombre }).lean();
    if (existente) {
      choferId.set(nombre, existente._id);
      continue;
    }
    anotar(`Chofer de ejemplo: ${nombre} (puesto Chofer; reemplázalo por el real en Personal)`);
    // WhatsApp de relleno: a los choferes el sistema no les manda mensajes.
    if (APLICAR) choferId.set(nombre, (await Empleado.create({ nombre, puesto: "Chofer", whatsapp: "0000000000" }))._id);
  }

  // ---------- Rutas ----------
  for (const r of RUTAS) {
    if (await Ruta.exists({ nombre: r.nombre })) continue;
    const paradas = r.paradas
      .map((p) => {
        if (!p.tienda) return { tipo: p.tipo, sucursalId: null, descripcion: p.descripcion };
        const tienda = sucursales.find((s) => p.tienda!.test(s.nombre));
        return tienda ? { tipo: "sucursal", sucursalId: tienda._id, descripcion: "" } : null;
      })
      .filter(Boolean);
    anotar(`Ruta nueva: ${r.horaSalida} ${r.nombre} — ${r.responsable}${r.sustituto ? ` / sustituto ${r.sustituto}` : ""} — ${paradas.length} paradas`);
    if (APLICAR) {
      await Ruta.create({
        nombre: r.nombre,
        tipo: r.tipo,
        horaSalida: r.horaSalida,
        duracionMin: r.duracionMin,
        requiereRefrigerado: !!r.requiereRefrigerado,
        ...(r.diasSemana ? { diasSemana: r.diasSemana } : {}),
        vehiculoPreferidoId: vehiculoId.get(r.vehiculo) ?? null,
        choferResponsableId: choferId.get(r.responsable) ?? null,
        choferSustitutoId: r.sustituto ? (choferId.get(r.sustituto) ?? null) : null,
        paradas,
        notas: r.notas ?? "",
        orden: r.orden,
      });
    }
  }

  // ---------- Productos clave ----------
  for (const c of CLAVE) {
    const producto = await Producto.findOne({ sku: c.sku, activo: true }).lean();
    if (!producto) {
      anotar(`Producto clave ${c.sku}: no existe, se omite`);
      continue;
    }
    // Ya configurado con el sistema nuevo: no se pisa.
    if ((producto.piezasPorCaja ?? 0) > 0) continue;
    const set = {
      esClave: true,
      piezasPorCaja: c.porCaja,
      cajasPorTarima: c.tarima ?? 0,
      stockMinimo: c.minCajas * c.porCaja,
      stockMaximo: c.maxCajas * c.porCaja,
      ...(c.vida && !(producto.vidaUtilDias ?? 0) ? { vidaUtilDias: c.vida } : {}),
    };
    respaldo.push({ _id: String(producto._id), sku: producto.sku, nombre: producto.nombre, antes: { stockMinimo: producto.stockMinimo, stockMaximo: producto.stockMaximo, esClave: producto.esClave ?? false, piezasPorCaja: 0, cajasPorTarima: producto.cajasPorTarima ?? 0, vidaUtilDias: producto.vidaUtilDias ?? 0 } });
    anotar(`Clave: ${producto.nombre} — mín ${c.minCajas} cajas, máx ${c.maxCajas} cajas de ${c.porCaja} ${producto.unidad === "kg" ? "kg" : "pzas"}${c.vida ? `, vida útil ${c.vida} días` : ""} (antes mín ${producto.stockMinimo}, máx ${producto.stockMaximo})`);
    if (APLICAR) await Producto.updateOne({ _id: producto._id }, { $set: set });
  }

  // ---------- Vida útil por línea ----------
  for (const v of VIDA_POR_LINEA) {
    const filtro = { linea: v.linea, activo: true, ...(v.unidad ? { unidad: v.unidad } : {}), $or: [{ vidaUtilDias: { $exists: false } }, { vidaUtilDias: 0 }] };
    const n = await Producto.countDocuments(filtro);
    if (!n) continue;
    anotar(`Vida útil ${v.dias} días a ${n} producto(s) de ${v.linea}${v.unidad ? ` (${v.unidad})` : ""} que no tenían`);
    if (APLICAR) await Producto.updateMany(filtro, { $set: { vidaUtilDias: v.dias } });
  }

  console.log(cambios.map((c) => `• ${c}`).join("\n") || "Nada por hacer: todo ya estaba configurado.");

  if (APLICAR && respaldo.length) {
    const carpeta = path.join(process.cwd(), "scripts", "logs");
    mkdirSync(carpeta, { recursive: true });
    const archivo = path.join(carpeta, `respaldo-seed-operacion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(archivo, JSON.stringify(respaldo, null, 2));
    console.log(`\nValores anteriores de los productos modificados: ${archivo}`);
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
