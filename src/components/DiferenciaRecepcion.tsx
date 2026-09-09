export function DiferenciaRecepcion({ esperado, recibido, referencia }: {
  esperado: number;
  recibido: number | string | null | undefined;
  referencia: "lo ordenado" | "lo surtido";
}) {
  if (recibido == null || (typeof recibido === "string" && !recibido.trim())) return null;
  const cantidad = Number(recibido);
  if (!Number.isFinite(cantidad) || cantidad < 0) return null;
  const diferencia = Math.round((cantidad - esperado) * 1e6) / 1e6;
  if (!diferencia) return null;
  return <p className="mt-1 text-xs font-medium text-amber-900">
    {diferencia < 0 ? "Faltante" : "Excedente"}: {Math.abs(diferencia).toLocaleString("es-MX", { maximumFractionDigits: 6 })} respecto a {referencia}
  </p>;
}
