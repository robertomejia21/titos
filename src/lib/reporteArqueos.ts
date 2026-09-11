export type FilaArqueo = {
  id: string; cajaId: string; sucursalId: string; sucursal: string; cajero: string;
  supervisor: string; fecha: string; esperado: number; contado: number;
  diferencia: number; esperadoUsd: number; contadoUsd: number; diferenciaUsd: number;
  notas: string; corte: null | { fecha: string; diferencia: number; diferenciaUsd: number };
};
export function importeConSigno(monto: number, moneda = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda, currencyDisplay: "narrowSymbol", signDisplay: "exceptZero" }).format(monto);
}
export function resumenArqueos(filas: FilaArqueo[]) {
  const centavos = (n: number) => Math.round(n * 100);
  return {
    cajasConDiferencia: filas.filter((f) => centavos(f.diferencia) !== 0 || centavos(f.diferenciaUsd) !== 0).length,
    faltantes: filas.reduce((s, f) => s + Math.min(0, centavos(f.diferencia)), 0) / 100,
    sobrantes: filas.reduce((s, f) => s + Math.max(0, centavos(f.diferencia)), 0) / 100,
    faltantesUsd: filas.reduce((s, f) => s + Math.min(0, centavos(f.diferenciaUsd)), 0) / 100,
    sobrantesUsd: filas.reduce((s, f) => s + Math.max(0, centavos(f.diferenciaUsd)), 0) / 100,
  };
}
