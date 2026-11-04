import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import mongoose from "mongoose";
import QRCode from "qrcode";
import { connectDB } from "@/lib/db";
import Pedido from "@/models/Pedido";
import Sucursal from "@/models/Sucursal";
import { BotonImprimir } from "@/components/BotonImprimir";
import { asegurarQrs } from "@/lib/trazabilidad";
import { salidaDelFolio } from "@/lib/tarjetaFolio";
import { categoriaLabel } from "@/lib/categorias";

// Etiquetas con QR para pegar en cada caja (o una para el folio si va sin
// cajas). Se imprimen en hoja normal: no hay que comprar etiquetas.

export const dynamic = "force-dynamic";

async function origen() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${host}`;
}

export default async function EtiquetasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) notFound();
  await connectDB();
  const pedido = await Pedido.findById(id);
  if (!pedido) notFound();
  if (asegurarQrs(pedido)) await pedido.save();

  const [sucursal, enSalida, base] = await Promise.all([Sucursal.findById(pedido.sucursalId).select("nombre").lean(), salidaDelFolio(id, pedido.carga), origen()]);
  const destino = (sucursal?.nombre as string | undefined) ?? "Sucursal";
  type CajaDoc = { numero: string; qr: string; categoria?: string; items: { nombreProducto: string; cantidad: number }[] };
  const cajas = pedido.cajas as CajaDoc[];

  const etiquetas = await Promise.all(
    (cajas.length
      ? cajas.map((c) => ({ clave: c.numero, titulo: `Caja ${c.numero} de ${cajas.length}`, categoria: c.categoria ?? "", contenido: c.items.map((i) => `${i.nombreProducto} (${i.cantidad})`).join(", "), qr: c.qr }))
      : [{ clave: "folio", titulo: "Folio sin cajas", categoria: "", contenido: `${pedido.items.length} producto(s)`, qr: pedido.qrToken as string }]
    ).map(async (e) => ({ ...e, svg: await QRCode.toString(`${base}/q/${e.qr}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) }))
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-titos-green-900">Etiquetas QR · {pedido.folio}</h1>
          <p className="text-sm text-black/55">Pega una en cada caja. Se leen con la tablet en carga, acomodo y recepción.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/matriz/pedidos/folio/${id}`} className="text-sm font-medium text-titos-green-700 hover:underline">
            ← Tarjeta del folio
          </Link>
          <BotonImprimir texto="Imprimir etiquetas" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
        {etiquetas.map((e) => (
          <section key={e.clave} className="flex break-inside-avoid gap-4 rounded-xl border-2 border-black p-4 print:rounded-none">
            <div className="h-36 w-36 shrink-0" dangerouslySetInnerHTML={{ __html: e.svg }} />
            <div className="min-w-0">
              <p className="text-2xl font-black leading-tight">{destino.replace(/^Sucursal /, "")}</p>
              <p className="font-mono text-lg font-bold">{pedido.folio}</p>
              <p className="text-base font-semibold">{e.titulo}</p>
              {e.categoria ? <p className="text-sm capitalize">{categoriaLabel(e.categoria)}</p> : null}
              <p className="mt-1 line-clamp-3 text-xs">{e.contenido}</p>
              {enSalida ? (
                <p className="mt-1 text-xs font-semibold">
                  {enSalida.salida.nombre} · {enSalida.fecha} {enSalida.salida.horaSalida}
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
