type RolCaja = { nombre?: string; perfilDocumentoId?: string | null; esSupervisor?: boolean };

export function requiereNipCaja(rol?: RolCaja | null, legado?: { role?: string; sucursalRol?: string }) {
  if (!rol) return legado?.role === "sucursal" && legado.sucursalRol === "ventas";
  return !!rol.esSupervisor || rol.perfilDocumentoId === "pos-cajero" ||
    ["caja", "cajero", "cajera", "cajer@"].includes((rol.nombre ?? "").trim().toLowerCase());
}
