"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function BotonImprimir({ texto = "Imprimir" }: { texto?: string }) {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <span className="inline-flex items-center gap-1.5">
        <Printer className="h-4 w-4" aria-hidden="true" /> {texto}
      </span>
    </Button>
  );
}
