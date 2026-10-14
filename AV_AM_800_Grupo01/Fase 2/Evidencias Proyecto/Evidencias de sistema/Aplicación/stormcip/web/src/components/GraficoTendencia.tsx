"use client";
import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Lectura, META, Rango, formatear } from "@/lib/tipos";
import { construirSerie } from "@/lib/serieTendencia";

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Tendencia de una variable en el ciclo mostrado. El eje X es el tiempo real
// (proporcional, desde el inicio del ciclo), cada lectura es un punto y la línea
// es recta y se corta donde hay un hueco grande: nada se suaviza ni se interpola.
export default function GraficoTendencia({
  lecturas, variable, rango, inicioMs, finMs,
}: {
  lecturas: Lectura[]; variable: string; rango?: Rango;
  /** Inicio del ciclo y fin (o "ahora" si sigue en curso), en ms. */
  inicioMs?: number | null; finMs?: number | null;
}) {
  // valorDe (dentro de construirSerie) busca primero en `valores` y luego en
  // `derivados`: el mismo gráfico sirve para conductividad y conductividad25C.
  const serie = useMemo(
    () => construirSerie(lecturas, variable, { inicioMs, finMs }),
    [lecturas, variable, inicioMs, finMs],
  );

  if (!serie.puntos.some((p) => p.valor !== null)) {
    return <p className="text-sm text-slate-500">Sin datos todavía.</p>;
  }

  const unidad = META[variable]?.unidad ?? "";

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={serie.puntos} margin={{ top: 18, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="t" type="number" scale="time" domain={[serie.desdeMs, serie.hastaMs]}
            tickFormatter={hora} tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={48} />
          <Tooltip labelFormatter={(t) => hora(Number(t))}
            formatter={(v) => [`${formatear(variable, Number(v))} ${unidad}`.trim(), META[variable]?.label ?? variable]} />
          {/* Los umbrales dibujados hacen legible la caída del enjuague. ifOverflow
              extiende el eje Y para que la línea del umbral siempre se vea. */}
          {rango?.max !== undefined && (
            <ReferenceLine y={rango.max} stroke="#dc2626" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: `Alerta > ${rango.max}`, position: "insideTopRight", fontSize: 10, fill: "#dc2626" }} />
          )}
          {rango?.min !== undefined && (
            <ReferenceLine y={rango.min} stroke="#dc2626" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: `Alerta < ${rango.min}`, position: "insideBottomRight", fontSize: 10, fill: "#dc2626" }} />
          )}
          <Line type="linear" dataKey="valor" stroke="#2563eb" strokeWidth={1.5}
            dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }} activeDot={{ r: 5 }}
            connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500">
        {serie.huecos > 0 && `${serie.huecos} corte${serie.huecos === 1 ? "" : "s"} de línea: hueco entre lecturas. `}
        Eje de tiempo proporcional desde el inicio del ciclo.
      </p>
    </div>
  );
}
