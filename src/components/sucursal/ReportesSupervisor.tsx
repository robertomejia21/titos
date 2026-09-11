"use client";
import { useState } from "react";
import { ReporteProductos } from "@/components/matriz/ReporteProductos";
import { HistorialVentasManager } from "@/components/matriz/HistorialVentasManager";
import { CortesManager } from "@/components/matriz/CortesManager";
import { ArqueosReporte } from "@/components/matriz/ArqueosReporte";
import { Button } from "@/components/ui";
export function ReportesSupervisor() {
  const [tab, setTab] = useState("productos");
  return <><div className="mb-4 flex flex-wrap gap-2">{[["productos", "Productos"], ["ventas", "Ventas"], ["cortes", "Cortes"], ["arqueos", "Arqueos"]].map(([id, label]) => <Button key={id} className="min-h-11" aria-pressed={tab === id} variant={tab === id ? "primary" : "ghost"} onClick={() => setTab(id)}>{label}</Button>)}</div>{tab === "productos" ? <ReporteProductos /> : tab === "ventas" ? <HistorialVentasManager /> : tab === "cortes" ? <CortesManager /> : <ArqueosReporte />}</>;
}
