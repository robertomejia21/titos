"use client";

import { useState } from "react";
import { Card, Select } from "@/components/ui";
import { DOCUMENTO_PERFILES_URL, PERFILES_DOCUMENTO } from "@/lib/perfilesDocumento";

export function PerfilesDocumento() {
  const [perfilId, setPerfilId] = useState(PERFILES_DOCUMENTO[0].id);
  const perfil = PERFILES_DOCUMENTO.find((p) => p.id === perfilId)!;
  const opciones = perfil.grupos.flatMap((g) => g.opciones);
  return (
    <Card>
      <h2 className="font-semibold text-titos-green-900">Perfiles del documento definitivo</h2>
      <p className="mt-2 text-sm text-black/70">
        Los nueve perfiles del archivo adjunto, revisado hoja por hoja. Las marcas muestran lo solicitado por el cliente.
        Su importación como permisos operativos está pendiente: varias funciones del documento aún no existen o necesitan permisos más específicos.
      </p>
      <label htmlFor="perfil-documento" className="mb-1 mt-4 block text-sm font-medium">Perfil del PDF</label>
      <Select id="perfil-documento" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
        {PERFILES_DOCUMENTO.map((p) => <option key={p.id} value={p.id}>{p.nombre} · página {p.pagina}</option>)}
      </Select>
      <p className="my-3 text-sm text-black/70">
        {opciones.filter((p) => p.marcado).length} de {opciones.length} opciones visibles marcadas.
        {" "}<a className="text-titos-green-800 underline" href={`${DOCUMENTO_PERFILES_URL}#page=${perfil.pagina}`} target="_blank" rel="noreferrer">Consultar página {perfil.pagina} del PDF</a>
      </p>
      {perfil.observaciones ? <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{perfil.observaciones}</p> : null}
      <div className="space-y-3">
        {perfil.grupos.map((grupo) => (
          <details key={`${perfil.id}-${grupo.nombre}`} open>
            <summary className="cursor-pointer rounded-md bg-black/5 p-2 font-medium focus-visible:outline-2 focus-visible:outline-titos-green-700">{grupo.nombre}</summary>
            <ul className="grid gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-2">
              {grupo.opciones.map((opcion) => <li key={opcion.nombre} className="flex gap-2 text-black/80">
                <span aria-hidden="true">{opcion.marcado ? "☑" : "☐"}</span>
                <span>{opcion.nombre}<span className="sr-only">: {opcion.marcado ? "marcado en el PDF" : "sin marcar en el PDF"}</span></span>
              </li>)}
            </ul>
          </details>
        ))}
      </div>
    </Card>
  );
}
