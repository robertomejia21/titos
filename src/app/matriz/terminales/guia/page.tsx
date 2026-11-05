import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { GuiaTerminales } from "@/components/matriz/GuiaTerminales";

export default function GuiaTerminalesPage() {
  return (
    <div>
      <PageHeader
        title="Guía de la terminal Banorte"
        description="Qué falta en cada sucursal para cobrar con la terminal desde el punto de venta, y cómo instalar el programa de caja"
        icon={BookOpen}
        action={
          <Link href="/matriz/terminales" className="text-sm font-medium text-titos-green-700 hover:underline">
            ← Terminales de pago
          </Link>
        }
      />
      <GuiaTerminales />
    </div>
  );
}
