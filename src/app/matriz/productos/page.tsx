import { Package } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ProductosManager } from "@/components/matriz/ProductosManager";

export default async function ProductosPage({searchParams}: {searchParams: Promise<{q?: string; accion?: string}>}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  return (
    <div>
      <PageHeader
        title="Productos"
        description="Catálogo central de productos que la matriz distribuye a las sucursales"
        icon={Package}
      />
      <ProductosManager key={`${q}:${params.accion ?? ""}`} initialQuery={q} initialCreate={params.accion === "nuevo"} />
    </div>
  );
}
