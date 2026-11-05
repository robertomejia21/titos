"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download, FolderOpen } from "lucide-react";
import { Button, Card, FormField, Input, Modal } from "@/components/ui";
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

// Arma el puente-caja.json de una sucursal en el navegador. La contraseña de
// Payworks nunca pasa por aquí: se escribe a mano en la PC de caja.
function configuracionPuente({ sucursal, afiliacion, ip, usuario }: { sucursal: string; afiliacion: string; ip: string; usuario: string }) {
  const json = {
    puerto: 8091,
    origenesPermitidos: [window.location.origin],
    banorte: {
      usarSimulador: true,
      rutaDll: "PINPAD.TPV",
      ipPinpad: ip,
      puertoPinpad: "1818",
      usuario,
      password: "",
      modo: "AUT",
      timeoutSegundos: 90,
      retardoSimuladorMs: 2000,
    },
  };
  return [
    `// Puente de caja · ${sucursal}${afiliacion ? ` · afiliación Banorte ${afiliacion}` : ""}`,
    `// Llenar en esta PC: password del Motor Payworks de esta afiliación${ip ? "" : ", ipPinpad"}${usuario ? "" : ", usuario"}.`,
    `// Cuando llegue PINPAD.TPV: copiarla a esta carpeta y poner usarSimulador en false.`,
    `// modo: AUT (prueba, no cobra). Cambiar a PRD solo con la carta de certificación.`,
    JSON.stringify(json, null, 2),
    "",
  ].join("\n");
}

function descargarArchivo(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DescargarConfiguracion({ sucursal, afiliacion, onClose }: { sucursal: string; afiliacion: string; onClose: () => void }) {
  const [ip, setIp] = useState("");
  const [usuario, setUsuario] = useState("");
  const ipValida = !ip || /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim());
  return (
    <Modal
      open
      onClose={onClose}
      title={`Configuración · ${sucursal}`}
      icon={Download}
      footer={
        <Button
          disabled={!ipValida}
          onClick={() => {
            descargarArchivo("puente-caja.json", configuracionPuente({ sucursal, afiliacion, ip: ip.trim(), usuario: usuario.trim() }));
            onClose();
          }}
        >
          Descargar puente-caja.json
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-black/70">
          {afiliacion ? <>Afiliación <b className="font-mono">{afiliacion}</b>. </> : null}
          Lo que dejes vacío se llena después en la PC de caja con el Bloc de notas.
        </p>
        <FormField label="IP de la terminal (opcional)">
          <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" />
        </FormField>
        {!ipValida ? <p className="text-xs text-red-600">Escribe la IP como 4 números separados por puntos.</p> : null}
        <FormField label="Usuario del Motor Payworks (opcional)">
          <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" />
        </FormField>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          La <b>contraseña</b> no se pide aquí: escríbela directo en el archivo, ya en la PC de caja. Guarda el archivo
          junto a <Codigo>PuenteCaja.exe</Codigo> con el nombre <Codigo>puente-caja.json</Codigo>.
        </p>
      </div>
    </Modal>
  );
}

function ProgramaCaja() {
  const [enlace, setEnlace] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setEnlace(c?.enlaceProgramaCaja ?? ""))
      .catch(() => setEnlace(""));
  }, []);

  async function guardar() {
    setError(null);
    setGuardando(true);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enlaceProgramaCaja: borrador.trim() }),
    });
    setGuardando(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(res.status === 403 ? "Para cambiar el enlace necesitas el permiso de editar la configuración." : data?.error ?? "No se pudo guardar el enlace.");
      return;
    }
    setEnlace(borrador.trim());
    setEditando(false);
  }

  if (enlace === null) return <p className="text-sm text-black/40">Cargando…</p>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-black/80">
        El programa de caja (<Codigo>PuenteCaja.exe</Codigo>) y la librería de Banorte (<Codigo>PINPAD.TPV</Codigo>,
        cuando llegue) están en una carpeta privada. Es el mismo programa para todas las sucursales; lo único distinto
        es el <Codigo>puente-caja.json</Codigo>, que se descarga en la tabla de arriba.
      </p>
      {editando ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <FormField label="Enlace de la carpeta">
              <Input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
            </FormField>
          </div>
          <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Button>
          <Button variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {enlace ? (
            <a
              href={enlace}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-titos-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-titos-green-900"
            >
              <FolderOpen className="h-4 w-4" /> Abrir carpeta del programa de caja
            </a>
          ) : (
            <span className="text-black/50">Todavía no hay enlace a la carpeta.</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => { setBorrador(enlace); setEditando(true); }}>
            {enlace ? "Cambiar enlace" : "Agregar enlace"}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-xs text-black/50">
        Comparte la carpeta solo con quien instala las cajas. No guardes ahí ningún <Codigo>puente-caja.json</Codigo> con contraseña.
      </p>
    </div>
  );
}

function AvancePorSucursal() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [terminales, setTerminales] = useState<Terminal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState<{ sucursal: string; afiliacion: string } | null>(null);

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
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {filas.map(({ sucursal, banorte }) =>
            banorte.length === 0 ? (
              <tr key={sucursal._id} className="border-b border-black/5">
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">{sucursal.nombre}</td>
                <td className="px-2 py-1.5 text-black/40" colSpan={3}>Sin terminal Banorte registrada</td>
                <td className="px-2 py-1.5"><Estado tono="falta">Dar de alta</Estado></td>
                <td />
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
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDescargando({ sucursal: banorte.length > 1 ? `${sucursal.nombre} · ${t.alias}` : sucursal.nombre, afiliacion: t.afiliacion ?? "" })}
                    >
                      <Download className="mr-1 inline h-3.5 w-3.5" />
                      Configuración
                    </Button>
                  </td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-black/50">
        “Lista en el sistema” solo indica que la terminal está capturada. La instalación en la PC de caja se revisa desde{" "}
        <b>Configuración → Punto de venta → Equipos de caja</b>, en la PC de cada sucursal. El botón “Configuración”
        descarga el <Codigo>puente-caja.json</Codigo> de esa terminal, con su afiliación anotada.
      </p>
      {descargando ? (
        <DescargarConfiguracion {...descargando} onClose={() => setDescargando(null)} />
      ) : null}
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

      <Seccion titulo="Programa de caja">
        <ProgramaCaja />
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
            Desde la PC de caja, crea la carpeta <Codigo>C:\PuenteCaja\</Codigo> y guarda ahí{" "}
            <Codigo>PuenteCaja.exe</Codigo> (de la carpeta del programa de caja, arriba) y el{" "}
            <Codigo>puente-caja.json</Codigo> de esa sucursal (botón “Configuración” en la tabla). No hay que instalar
            nada más.
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
