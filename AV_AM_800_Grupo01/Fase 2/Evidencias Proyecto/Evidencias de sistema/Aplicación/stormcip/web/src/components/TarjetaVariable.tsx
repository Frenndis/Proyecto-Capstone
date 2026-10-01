"use client";
import { META, Rango, fueraDeRango } from "@/lib/tipos";

export default function TarjetaVariable(
  { variable, valor, rango }: { variable: string; valor?: number; rango?: Rango }
) {
  const meta = META[variable];
  const sinDato = valor === undefined || valor === null;
  const alerta = !sinDato && fueraDeRango(valor, rango);

  const objetivo = rango
    ? `Objetivo ${rango.min ?? "—"}${rango.max !== undefined ? `–${rango.max}` : " o más"}`
    : "Sin umbral definido";

  return (
    <div className={`rounded-xl border p-4 ${alerta
      ? "border-red-400 bg-red-50 dark:bg-red-950/30"
      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{meta?.label ?? variable}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-red-600" : ""}`}>
        {sinDato ? "—" : valor.toFixed(2)}
        <span className="ml-1 text-sm font-normal text-slate-500">{meta?.unidad}</span>
      </p>
      <p className={`mt-1 text-xs ${alerta ? "text-red-600" : "text-slate-500"}`}>
        {alerta ? "Fuera de rango" : objetivo}
      </p>
    </div>
  );
}
