// Diagnóstico de SOLO LECTURA: qué roles existen, qué permisos traen y cuáles
// del catálogo actual les faltan. No escribe nada.
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { connectDB } from "@/lib/db";
import RolModel from "@/models/Rol";
import UserModel from "@/models/User";
import { PERMISOS, permisosDeAmbito } from "@/lib/permisos";

async function main() {
  await connectDB();

  const roles = await RolModel.find({}).sort({ ambito: 1, nombre: 1 }).lean();
  console.log(`Catálogo actual: ${PERMISOS.length} permisos\n`);

  for (const rol of roles) {
    const delAmbito = permisosDeAmbito(rol.ambito as "matriz" | "sucursal").map((p) => p.clave);
    const tiene: string[] = rol.permisos ?? [];
    const faltan = delAmbito.filter((c) => !tiene.includes(c));
    console.log(`[${rol.ambito}] ${rol.nombre}${rol.esSistema ? " (sistema)" : ""}`);
    console.log(`   permisos: ${tiene.length}/${delAmbito.length}`);
    if (faltan.length > 0) console.log(`   FALTAN:   ${faltan.join(", ")}`);
    console.log(`   catalogos.administrar: ${tiene.includes("catalogos.administrar") ? "sí" : "NO"}`);
  }

  console.log("\nUsuarios de matriz:");
  const usuarios = await UserModel.find({ role: "matriz" })
    .select("nombre email rolId activo")
    .populate("rolId", "nombre permisos")
    .lean();

  for (const u of usuarios) {
    const rol = u.rolId && typeof u.rolId === "object" ? (u.rolId as { nombre: string; permisos: string[] }) : null;
    console.log(
      `  ${u.nombre} <${u.email}>${u.activo ? "" : " (inactivo)"} — ` +
        (rol
          ? `rol "${rol.nombre}", catalogos.administrar: ${
              (rol.permisos ?? []).includes("catalogos.administrar") ? "sí" : "NO"
            }`
          : "sin rol asignado (perfil heredado = acceso completo de matriz)")
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
