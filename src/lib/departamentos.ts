import { isValidObjectId } from "mongoose";
import Departamento from "@/models/Departamento";

export function claveDepartamento(nombre: string) {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

export async function departamentoValido(id: unknown) {
  if (id === null || id === "") return true;
  return typeof id === "string" && isValidObjectId(id) && !!await Departamento.exists({ _id: id, activo: true });
}
