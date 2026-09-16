"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { permisosDeAmbito, type AmbitoRolPermiso } from "@/lib/permisos";
import { DETALLE_FUNCION, FUNCIONES_CONSULTA } from "@/lib/permisosIndividuales";

export function PermisosUsuarioEditor({ ambito, base, seleccion, consulta, disabled, onChange }: {
  ambito: AmbitoRolPermiso; base: string[]; seleccion: string[] | null; consulta: string[]; disabled?: boolean;
  onChange: (permisos: string[] | null, consulta: string[]) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const elegidos = seleccion ?? base;
  const disponibles = permisosDeAmbito(ambito);
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visibles = disponibles.filter((p) => normalizar(`${p.etiqueta} ${p.grupo} ${DETALLE_FUNCION[p.clave]}`).includes(normalizar(busqueda.trim())));
  const grupos = [...new Set(visibles.map((p) => p.grupo))];
  function cambiar(clave: string, modo: string) {
    const permisos = elegidos.filter((p) => p !== clave);
    if (modo !== "ninguno") permisos.push(clave);
    onChange(permisos, [...consulta.filter((p) => p !== clave), ...(modo === "consulta" && !FUNCIONES_CONSULTA.has(clave) ? [clave] : [])]);
  }
  return <section className="space-y-3 border-t border-black/20 pt-4" aria-label="Funciones de este usuario">
    <div>
      <h3 className="font-semibold text-titos-green-900">Funciones de este usuario</h3>
      <p className="text-sm text-black/75">Puedes dar o quitar funciones sin cambiar su puesto. Las operaciones de sucursal se limitan a su tienda; los reportes globales son solo de consulta.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{seleccion === null ? "Usa los permisos del puesto" : "Permisos personalizados"} · {elegidos.length} de {disponibles.length}</span>
      <Button variant="ghost" disabled={disabled || seleccion === null} onClick={() => onChange(null, [])}>Restablecer los del puesto</Button>
      <Button variant="ghost" disabled={disabled || elegidos.length === 0} onClick={() => onChange([], [])}>Quitar todos</Button>
    </div>
    {disabled ? <p className="text-sm text-amber-900">Otro administrador debe cambiar tus permisos para evitar que pierdas tu propio acceso.</p> : null}
    <Input type="search" aria-label="Buscar función" placeholder="Buscar función: ventas, productos, clientes…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="border-black/50" />
    <p className="text-xs text-black/75">Sin acceso: oculta la sección. Solo consulta: permite verla y bloquea cambios. Consultar y operar: permite las acciones descritas. Las consultas de apoyo necesarias para cobrar o preparar pedidos se conservan.</p>
    {grupos.length === 0 ? <p role="status">No hay funciones que coincidan.</p> : grupos.map((grupo) => <fieldset key={grupo} className="border-t border-black/15 pt-2">
      <legend className="px-1 text-sm font-semibold text-titos-green-900">{grupo}</legend>
      {visibles.filter((p) => p.grupo === grupo).map((p) => <div key={p.clave} className="grid gap-2 border-b border-black/5 py-3 sm:grid-cols-[1fr_185px] sm:items-center">
        <div><label htmlFor={`funcion-${p.clave}`} className="text-sm font-medium text-black/90">{p.etiqueta}</label><p className="mt-1 text-xs text-black/75">{DETALLE_FUNCION[p.clave] ?? p.ayuda}</p></div>
        <Select id={`funcion-${p.clave}`} aria-label={p.etiqueta} className="border-black/50" disabled={disabled}
          value={!elegidos.includes(p.clave) ? "ninguno" : FUNCIONES_CONSULTA.has(p.clave) || consulta.includes(p.clave) ? "consulta" : "operar"}
          onChange={(e) => cambiar(p.clave, e.target.value)}>
          <option value="ninguno">Sin acceso</option>
          <option value="consulta">Solo consulta</option>
          {!FUNCIONES_CONSULTA.has(p.clave) ? <option value="operar">Consultar y operar</option> : null}
        </Select>
      </div>)}
    </fieldset>)}
  </section>;
}
