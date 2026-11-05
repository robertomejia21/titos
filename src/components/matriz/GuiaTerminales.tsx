"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { SkeletonTabla } from "@/components/Skeleton";

// Guía de instalación del cobro integrado con Banorte (Payworks Interredes Remoto).
// El avance por sucursal sale de las terminales capturadas en el sistema: las
// afiliaciones no se escriben aquí porque el repositorio es público.

type Sucursal = { _id: string; nombre: string };
type Terminal = {
  _id: string;
  alias: string;
  banco: string;
  numeroSerie: string;
  activo: boolean;
  cobroIntegrado?: boolean;
  afiliacion?: string;
  sucursalId: { _id: string; nombre: string } | string;
};

function idSucursal(t: Terminal) {
  return typeof t.sucursalId === "string" ? t.sucursalId : t.sucursalId._id;
}

function esBanorte(t: Terminal) {
  return !!t.cobroIntegrado || /banorte/i.test(t.banco);
}

function Estado({ tono, children }: { tono: "ok" | "aviso" | "falta"; children: ReactNode }) {
  const clases = {
    ok: "bg-titos-green-100 text-titos-green-700",
    aviso: "bg-amber-100 text-amber-800",
    falta: "bg-black/5 text-black/60",
  }[tono];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${clases}`}>{children}</span>;
}

function Codigo({ children }: { children: ReactNode }) {
  return <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[13px] text-black/80">{children}</code>;
}

function Pasos({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-black/80 marker:font-semibold marker:text-titos-green-700">{children}</ol>;
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-3 font-semibold text-titos-green-900">{titulo}</h2>
      {children}
    </Card>
  );
}

function AvancePorSucursal() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [terminales, setTerminales] = useState<Terminal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([fetch("/api/sucursales"), fetch("/api/terminales?todos=1")])
      .then(async ([rs, rt]) => {
        if (rs.ok) setSucursales(await rs.json());
        if (rt.ok) setTerminales(await rt.json());
      })
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <SkeletonTabla />;

  const filas = sucursales.map((s) => {
    const banorte = terminales.filter((t) => t.activo && esBanorte(t) && idSucursal(t) === s._id);
    return { sucursal: s, banorte };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-black/10 text-black/50">
            <th className="px-2 py-1.5 text-xs font-medium">Sucursal</th>
            <th className="px-2 py-1.5 text-xs font-medium">Terminal</th>
            <th className="px-2 py-1.5 text-xs font-medium">Afiliación</th>
            <th className="px-2 py-1.5 text-xs font-medium">Serie</th>
            <th className="px-2 py-1.5 text-xs font-medium">Estado en el sistema</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ sucursal, banorte }) =>
            banorte.length === 0 ? (
              <tr key={sucursal._id} className="border-b border-black/5">
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">{sucursal.nombre}</td>
                <td className="px-2 py-1.5 text-black/40" colSpan={3}>Sin terminal Banorte registrada</td>
                <td className="px-2 py-1.5"><Estado tono="falta">Dar de alta</Estado></td>
              </tr>
            ) : (
              banorte.map((t, i) => (
                <tr key={t._id} className="border-b border-black/5">
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium">{i === 0 ? sucursal.nombre : ""}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{t.alias}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums">{t.afiliacion || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums">{t.numeroSerie || "—"}</td>
                  <td className="px-2 py-1.5">
                    {!t.cobroIntegrado ? (
                      <Estado tono="aviso">Activar cobro integrado</Estado>
                    ) : !t.afiliacion ? (
                      <Estado tono="aviso">Falta afiliación</Estado>
                    ) : (
                      <Estado tono="ok">Lista en el sistema</Estado>
                    )}
                  </td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-black/50">
        “Lista en el sistema” solo indica que la terminal está capturada. La instalación en la PC de caja se revisa desde{" "}
        <b>Configuración → Punto de venta → Equipos de caja</b>, en la PC de cada sucursal.
      </p>
    </div>
  );
}

export function GuiaTerminales() {
  return (
    <div className="max-w-4xl">
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>
          <b>Mientras no llegue la librería de Banorte</b> (<Codigo>PINPAD.TPV</Codigo>) y no se certifique, el cobro con
          terminal funciona solo en modo prueba (<b>AUT</b>): la venta se registra, pero <b>no se le cobra nada al cliente</b>.
          Hasta entonces, en caja se usa <b>“Cobrar manual”</b>.
        </p>
      </div>

      <Seccion titulo="Avance por sucursal">
        <AvancePorSucursal />
      </Seccion>

      <Seccion titulo="Cómo funciona">
        <p className="mb-2 text-sm text-black/80">
          El navegador no habla directo con la terminal. En cada PC de caja corre un programa pequeño, el{" "}
          <b>puente de caja</b> (<Codigo>PuenteCaja.exe</Codigo>), que recibe el cobro del punto de venta y se lo pasa a
          la terminal por la red del local. La terminal habla con Banorte y la autorización regresa sola a la venta.
        </p>
        <p className="text-sm text-black/80">
          Cada sucursal tiene su propia afiliación, su usuario de Payworks y su PC de caja. El usuario, la contraseña y la
          IP de la terminal viven solo en el archivo <Codigo>puente-caja.json</Codigo> de esa PC: no van en Vercel ni en
          el sistema.
        </p>
      </Seccion>

      <Seccion titulo="1. Dar de alta la terminal en el sistema">
        <Pasos>
          <li>
            Entra a <b>Catálogos → Terminales de pago</b> y crea o edita la terminal Banorte de la sucursal.
          </li>
          <li>
            Activa <b>Cobro integrado con Banorte</b> y escribe la <b>afiliación</b> de esa sucursal. El número de serie
            (etiqueta de atrás de la terminal) se puede agregar después.
          </li>
          <li>
            Si una sucursal tiene dos terminales, registra cada una con su propio nombre y su afiliación.
          </li>
        </Pasos>
      </Seccion>

      <Seccion titulo="2. Instalar el programa de caja en la sucursal">
        <Pasos>
          <li>
            Copia el kit de la sucursal (por USB) a <Codigo>C:\PuenteCaja\</Codigo> en la PC de caja. Trae{" "}
            <Codigo>PuenteCaja.exe</Codigo> y <Codigo>puente-caja.json</Codigo>; no hay que instalar nada más.
          </li>
          <li>
            En la terminal, ve a la pantalla <b>“Esperando comando · Vía red”</b> y anota la IP y el puerto (1818).
            Reserva esa IP en el router de la sucursal para que no cambie.
          </li>
          <li>
            Abre <Codigo>puente-caja.json</Codigo> con el Bloc de notas y llena <Codigo>ipPinpad</Codigo>,{" "}
            <Codigo>usuario</Codigo> y <Codigo>password</Codigo> (los del Motor Payworks de la afiliación de esa sucursal).
          </li>
          <li>
            Para que arranque con Windows: <Codigo>Win + R</Codigo> → <Codigo>shell:startup</Codigo> → acceso directo a{" "}
            <Codigo>C:\PuenteCaja\PuenteCaja.exe</Codigo>, con “Iniciar en” <Codigo>C:\PuenteCaja</Codigo>.
          </li>
          <li>La PC de caja y la terminal deben estar en la misma red WiFi.</li>
        </Pasos>
      </Seccion>

      <Seccion titulo="3. Cuando llegue la librería de Banorte">
        <Pasos>
          <li>
            Copia <Codigo>PINPAD.TPV</Codigo> a la carpeta <Codigo>C:\PuenteCaja\</Codigo> de cada sucursal.
          </li>
          <li>
            En <Codigo>puente-caja.json</Codigo> cambia <Codigo>&quot;usarSimulador&quot;: true</Codigo> a{" "}
            <Codigo>false</Codigo> y reinicia el programa. Debe decir <b>“PinPad: DLL cargada”</b>.
          </li>
          <li>
            Desde la PC de caja, en <b>Configuración → Punto de venta → Equipos de caja</b>:
            <ul className="mt-1 list-disc space-y-1 pl-5 text-black/60">
              <li><b>Revisar puente</b>: debe decir “librería de Banorte cargada · modo AUT”.</li>
              <li><b>Cargar llave</b>: una sola vez y obligatoria; sin ella la terminal rechaza todo.</li>
              <li><b>Prueba de cobro $1.00</b> con una tarjeta.</li>
            </ul>
          </li>
          <li>Haz una venta con tarjeta, cancélala desde el historial y prueba una devolución a tarjeta.</li>
        </Pasos>
      </Seccion>

      <Seccion titulo="4. Pasar a cobro real">
        <Pasos>
          <li>
            Solicita la certificación a Soporte Payworks Interredes (L.Soporte_Payworks_Interredes@banorte.com, lunes a
            viernes de 9:00 a 18:00) y haz las pruebas que pida el laboratorio.
          </li>
          <li>
            Con la carta de certificación: en el <Codigo>puente-caja.json</Codigo> de cada sucursal cambia{" "}
            <Codigo>&quot;modo&quot;</Codigo> a <Codigo>PRD</Codigo> y reinicia el programa.
          </li>
          <li>
            En Vercel agrega la variable <Codigo>BANORTE_SOLO_PRODUCCION=1</Codigo> y vuelve a publicar. Así el sistema
            rechaza cualquier venta cobrada por error en modo prueba.
          </li>
        </Pasos>
      </Seccion>

      <Seccion titulo="Si algo falla">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {[
            ["“El puente de caja no responde”", "Abrir PuenteCaja.exe en esa PC."],
            ["-1001 / -1003 / -1013", "No se alcanza la terminal: encendida, en “Esperando comando · Vía red”, misma red e IP correcta."],
            ["-2020 / PAYW-2019", "Falta cargar la llave (Equipos de caja → Cargar llave)."],
            ["PAYW-3003", "Usuario o contraseña de Payworks incorrectos en puente-caja.json."],
            ["-2006", "El cliente canceló en la terminal o se acabó el tiempo."],
            ["Afiliación distinta", "El puente de esa caja tiene los datos de otra sucursal: revisar usuario y contraseña."],
            ["“No se encontró una terminal válida para el dispositivo”", "Pedir a Banorte que vincule la serie de la terminal con su afiliación."],
          ].map(([codigo, accion]) => (
            <div key={codigo} className="contents">
              <dt className="font-mono text-[13px] text-black/80">{codigo}</dt>
              <dd className="mb-1 text-black/60 sm:mb-0">{accion}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-black/60">
          Si la terminal o el programa de caja no responden, la cajera puede marcar <b>“Cobrar manual”</b> y seguir
          trabajando. Los cobros sin respuesta aparecen abajo en <b>Terminales de pago</b> para revisarlos.
        </p>
      </Seccion>
    </div>
  );
}
