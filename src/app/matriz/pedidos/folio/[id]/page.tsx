import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import mongoose from "mongoose";
import { IdCard } from "lucide-react";
import { getSession } from "@/lib/getSession";
import { connectDB } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { TarjetaFolioVista } from "@/components/TarjetaFolioVista";
import { AccionesCarga } from "@/components/matriz/AccionesCarga";
import { armarTarjetaFolio } from "@/lib/tarjetaFolio";
import { puedeVerMontosTraspasos } from "@/lib/montosTraspasos";

export const dynamic = "force-dynamic";

export default async function TarjetaFolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!mongoose.isValidObjectId(id)) notFound();

  await connectDB();
  const tarjeta = await armarTarjetaFolio(id, await puedeVerMontosTraspasos(session));
  if (!tarjeta) notFound();

  const operable = tarjeta.estado !== "recibido" && tarjeta.etapa !== "en_ruta";

  return (
    <div>
      <PageHeader
        title="Tarjeta digital del folio"
        description="Quién capturó, surtió y cargó; contenido de cada caja, salida, chofer y hora."
        icon={IdCard}
        action={
          <div className="flex flex-wrap items-center gap-4">
            <Link href={`/matriz/pedidos/folio/${id}/etiquetas`} className="text-sm font-medium text-titos-green-700 hover:underline">
              Etiquetas QR
            </Link>
            <Link href="/matriz/pedidos" className="text-sm font-medium text-titos-green-700 hover:underline">
              ← Pedidos
            </Link>
          </div>
        }
      />
      <TarjetaFolioVista
        tarjeta={tarjeta}
        acciones={
          operable ? (
            <AccionesCarga
              pedidoId={tarjeta._id}
              etapa={tarjeta.etapa}
              impedimentos={tarjeta.impedimentosPrecarga}
              fechaSalida={tarjeta.fechaSalida}
              salidaId={tarjeta.salidaId}
            />
          ) : undefined
        }
      />
    </div>
  );
}
