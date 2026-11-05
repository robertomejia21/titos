import Link from "next/link";
import { BookOpen, CreditCard } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { TerminalesManager } from "@/components/matriz/TerminalesManager";

export default function TerminalesPage() {
  return (
    <div>
      <PageHeader
        title="Terminales de pago"
        description="Las terminales bancarias de cada sucursal: el punto de venta registra con cuál se cobró y el corte las desglosa"
        icon={CreditCard}
        action={
          <Link
            href="/matriz/terminales/guia"
            className="inline-flex items-center gap-1.5 rounded-lg border border-titos-green-700/30 px-3 py-1.5 text-sm font-medium text-titos-green-700 hover:bg-titos-green-100"
          >
            <BookOpen className="h-4 w-4" /> Guía terminal Banorte
          </Link>
        }
      />
      <TerminalesManager />
    </div>
  );
}
