import { redirect } from "next/navigation";
import { getSession } from "@/lib/getSession";

// Lo que abre el QR de una caja leído con la cámara normal del teléfono: manda
// al escáner del lado que corresponde (CEDIS o tienda) con el código ya puesto.

export const dynamic = "force-dynamic";

export default async function CodigoQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const codigo = encodeURIComponent(token);
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/q/${token}`)}`);
  redirect(session.role === "matriz" ? `/matriz/escanear?c=${codigo}` : `/sucursal/escanear?c=${codigo}`);
}
