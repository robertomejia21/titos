import Link from "next/link";
import { ScanLine } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { EscanerQR } from "@/components/EscanerQR";

export default async function EscanearCedisPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  return (
    <div>
      <PageHeader
        title="Escanear cajas"
        description="Lee el QR de cada caja al subirla a la unidad y al acomodarla por chofer. Si algo no cuadra, el sistema avisa."
        icon={ScanLine}
        action={
          <Link href="/matriz/incidencias" className="text-sm font-medium text-titos-green-700 hover:underline">
            Incidencias →
          </Link>
        }
      />
      <EscanerQR puntos={["carga", "acomodo"]} codigoInicial={c} rutaFolio="/matriz/pedidos/folio/" />
    </div>
  );
}
