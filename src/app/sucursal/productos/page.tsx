import { Package } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ProductosSucursal } from "@/components/sucursal/ProductosSucursal";

export default async function ProductosSucursalPage({searchParams}: {searchParams: Promise<{q?: string; accion?: string}>}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  return (
    <div>
      <PageHeader
        title="Productos"
        description="Catálogo de productos con la existencia actual de tu sucursal"
        icon={Package}
      />
      <ProductosSucursal key={`${q}:${params.accion ?? ""}`} initialQuery={q} />
    </div>
  );
}
