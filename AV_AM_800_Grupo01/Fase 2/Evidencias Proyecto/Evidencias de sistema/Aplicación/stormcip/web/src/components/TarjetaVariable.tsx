"use client";
import { META, Rango, SIN_UMBRAL, esDerivado, formatear, formatearRango, fueraDeRango } from "@/lib/tipos";

export default function TarjetaVariable({
  variable, valor, rango, confianza,
}: {
  variable: string; valor?: number | null; rango?: Rango;
  confianza?: "medido" | "estimado";
}) {
  const meta = META[variable];
  const sinDato = valor === undefined || valor === null;
  const alerta = !sinDato && fueraDeRango(valor, rango);
  const calculado = esDerivado(variable);

  const umbral = formatearRango(rango);
  const objetivo = umbral !== SIN_UMBRAL
    ? `Objetivo ${umbral}`
    : calculado ? "Valor calculado" : SIN_UMBRAL;

  return (
    <div className={`rounded-xl border p-4 ${alerta
      ? "border-red-400 bg-red-50 dark:bg-red-950/30"
      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {meta?.label ?? variable}
        </p>
        {/* Distinguir medición de cálculo: el usuario tiene que saber qué mira */}
        {calculado && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]
                           text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {confianza === "estimado" ? "estimado" : "calculado"}
          </span>
        )}
      </div>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-red-600" : ""}`}>
        {formatear(variable, valor)}
        <span className="ml-1 text-sm font-normal text-slate-500">{meta?.unidad}</span>
      </p>
      <p className={`mt-1 text-xs ${alerta ? "text-red-600" : "text-slate-500"}`}>
        {alerta ? "Fuera de rango" : objetivo}
      </p>
    </div>
  );
}
