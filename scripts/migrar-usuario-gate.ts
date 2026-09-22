import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { connectDB } from "../src/lib/db";
import UserModel from "../src/models/User";

// Migración al login por "usuario":
// 1) Reemplaza el índice único NO disperso de email (email_1) por el nuevo
//    disperso, para que varios usuarios puedan quedarse sin correo.
// 2) Rellena `usuario` en los usuarios existentes que aún no lo tienen (a partir
//    del correo, o del teléfono), garantizando que puedan seguir entrando.
async function migrar() {
  await connectDB();
  const coleccion = UserModel.collection;

  const indices = await coleccion.indexes();
  const emailViejo = indices.find((i) => i.name === "email_1" && !i.sparse);
  if (emailViejo) {
    console.log("Eliminando índice email_1 no disperso…");
    await coleccion.dropIndex("email_1");
  }
  // Deja que mongoose recree los índices dispersos declarados en el esquema.
  await UserModel.syncIndexes();

  const usados = new Set(
    (await UserModel.find({ usuario: { $ne: null } }).select("usuario").lean()).map((u) => u.usuario as string)
  );
  const unico = (base: string) => {
    let cand = base || "usuario";
    let n = 1;
    while (usados.has(cand)) cand = `${base}${++n}`;
    usados.add(cand);
    return cand;
  };

  const sinUsuario = await UserModel.find({ $or: [{ usuario: null }, { usuario: { $exists: false } }] })
    .select("email telefono")
    .lean();

  let actualizados = 0;
  for (const u of sinUsuario) {
    const base = (u.email?.split("@")[0] || u.telefono || "").toString().trim();
    const usuario = unico(base);
    await UserModel.updateOne({ _id: u._id }, { usuario });
    actualizados++;
  }

  console.log(`Listo. ${actualizados} usuarios recibieron un "usuario".`);
  process.exit(0);
}

migrar().catch((e) => {
  console.error(e);
  process.exit(1);
});
