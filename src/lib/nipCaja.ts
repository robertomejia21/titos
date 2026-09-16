type RolCaja = { nombre?: string; codigoSistema?: string | null; perfilDocumentoId?: string | null; esSupervisor?: boolean };

export function requiereNipCaja(rol?: RolCaja | null, _legado?: { role?: string; sucursalRol?: string }) {
  void _legado;
  // El código conserva la identidad del gerente aunque se cambie su nombre.
  return rol?.codigoSistema === "gerente-tienda" || rol?.perfilDocumentoId === "pos-gerente";
}
