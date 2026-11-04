import { SkeletonPagina } from "@/components/Skeleton";

// Se ve al instante al cambiar de pantalla, dentro del menú, mientras el
// servidor arma la página nueva: así se nota que el sistema está trabajando.
export default function Cargando() {
  return <SkeletonPagina />;
}
