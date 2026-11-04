"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, Select, formatMoney } from "@/components/ui";
import { SkeletonTabla } from "@/components/Skeleton";

type Punto = { label: string; total: number };
type Datos = {
  periodo: string;
  actual: Punto[];
  anterior: Punto[];
  totalActual: number;
  totalAnterior: number;
  variacionPct: number | null;
  tendencia: { direccion: "alza" | "baja" | "estable"; cambioPct: number; valores: number[] };
};

const OPCIONES_PERIODO = [
  { value: "diario", label: "Diario (últimos 14 días)" },
  { value: "semanal", label: "Semanal (últimas 12 semanas)" },
  { value: "mensual", label: "Mensual (últimos 12 meses)" },
];

const DIRECCION_TEXTO: Record<string, string> = { alza: "Al alza", baja: "A la baja", estable: "Estable" };
const DIRECCION_COLOR: Record<string, string> = {
  alza: "text-titos-green-700",
  baja: "text-red-600",
  estable: "text-black/50",
};

export function VentasChart() {
  const [periodo, setPeriodo] = useState("diario");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar el periodo seleccionado
    setLoading(true);
    fetch(`/api/reportes/ventas?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelado) setDatos(data);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [periodo]);

  const filas =
    datos?.actual.map((p, i) => ({
      periodo: p.label,
      actual: p.total,
      anterior: datos.anterior[i]?.total ?? 0,
      tendencia: datos.tendencia.valores[i] ?? null,
    })) ?? [];

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-titos-green-900">Ventas por periodo</h2>
        <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-auto">
          {OPCIONES_PERIODO.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {loading || !datos ? (
        <SkeletonTabla />
      ) : datos.actual.every((p) => p.total === 0) && datos.anterior.every((p) => p.total === 0) ? (
        <p className="rounded-xl border border-dashed border-black/10 bg-black/2 p-8 text-center text-sm text-black/50">
          Todavía no hay ventas registradas (pedidos surtidos o recibidos) en este rango.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-black/40">Periodo actual</p>
              <p className="font-semibold text-titos-green-900">{formatMoney(datos.totalActual)}</p>
            </div>
            <div>
              <p className="text-black/40">Periodo anterior</p>
              <p className="font-semibold text-black/60">{formatMoney(datos.totalAnterior)}</p>
            </div>
            <div>
              <p className="text-black/40">Variación vs. anterior</p>
              <p
                className={`font-semibold ${
                  datos.variacionPct === null
                    ? "text-black/40"
                    : datos.variacionPct >= 0
                      ? "text-titos-green-700"
                      : "text-red-600"
                }`}
              >
                {datos.variacionPct === null
                  ? "Sin datos previos"
                  : `${datos.variacionPct > 0 ? "+" : ""}${datos.variacionPct}%`}
              </p>
            </div>
            <div>
              <p className="text-black/40">Tendencia calculada</p>
              <p className={`font-semibold ${DIRECCION_COLOR[datos.tendencia.direccion]}`}>
                {DIRECCION_TEXTO[datos.tendencia.direccion]} ({datos.tendencia.cambioPct > 0 ? "+" : ""}
                {datos.tendencia.cambioPct}%)
              </p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filas} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Periodo actual"
                  stroke="#1e7a34"
                  strokeWidth={2.5}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="anterior"
                  name="Periodo anterior"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="tendencia"
                  name="Tendencia"
                  stroke="#f5821f"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
