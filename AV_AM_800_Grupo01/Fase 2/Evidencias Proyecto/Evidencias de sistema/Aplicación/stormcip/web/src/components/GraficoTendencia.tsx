"use client";
import { useMemo, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ETAPAS_MONITOREADAS, ETAPA_LABEL, Lectura, META, Rango, formatear } from "@/lib/tipos";
import { PuntoSerie, construirSerie, franjasPorEtapa } from "@/lib/serieTendencia";
import { VARIABLES_DE_PLANTA } from "@/lib/historialPlanta";

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Franjas de fondo: azul en las etapas monitoreadas, ámbar en las químicas.
const COLOR_MONITOREADA = "#bfdbfe";
const COLOR_NO_MONITOREADA = "#fde68a";

// Un punto por lectura. Los saturados (cota inferior: el valor real es mayor) y
// los fuera de operación (dato no confiable) se dibujan distinto del medido.
function Punto({ cx, cy, payload }: { cx?: number; cy?: number; payload?: PuntoSerie }) {
  if (cx === undefined || cy === undefined || !payload || payload.valor === null) return <g />;
  if (payload.confianza === "saturado") {
    return <circle cx={cx} cy={cy} r={4} fill="#ffffff" stroke="#d97706" strokeWidth={2} />;
  }
  if (payload.confianza === "fuera_de_operacion") {
    return (
      <g stroke="#6b7280" strokeWidth={2}>
        <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} />
        <line x1={cx - 3.5} y1={cy + 3.5} x2={cx + 3.5} y2={cy - 3.5} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill="#2563eb" />;
}

// Tendencia de una variable en el ciclo mostrado. El eje X es el tiempo real
// (proporcional, desde el inicio del ciclo), cada lectura es un punto y la línea
// es recta y se corta donde hay un hueco grande: nada se suaviza ni se interpola.
export default function GraficoTendencia({
  lecturas, variable, rango, inicioMs, finMs, etapaActual,
}: {
  lecturas: Lectura[]; variable: string; rango?: Rango;
  /** Inicio del ciclo y fin (o "ahora" si sigue en curso), en ms. */
  inicioMs?: number | null; finMs?: number | null;
  etapaActual?: string;
}) {
  // Por defecto solo las etapas monitoreadas: en las químicas la sonda satura o
  // opera fuera de su rango y aplasta la escala de la curva del enjuague.
  const [filtroMonitoreadas, setSoloMonitoreadas] = useState(true);
  // La concentración de la solución importa justo en las etapas químicas (el
  // lavado alcalino se dosifica y debe mantenerse estable): sin filtro y sin interruptor.
  const deQuimico = VARIABLES_DE_PLANTA.includes(variable);
  const soloMonitoreadas = filtroMonitoreadas && !deQuimico;

  // valorDe (dentro de construirSerie) busca primero en `valores` y luego en
  // `derivados`: el mismo gráfico sirve para conductividad y conductividad25C.
  const serie = useMemo(
    () => construirSerie(lecturas, variable, {
      inicioMs, finMs, soloEtapas: soloMonitoreadas ? ETAPAS_MONITOREADAS : undefined,
    }),
    [lecturas, variable, inicioMs, finMs, soloMonitoreadas],
  );
  const franjas = useMemo(
    () => franjasPorEtapa(lecturas, { inicioMs, finMs, etapaActual }),
    [lecturas, inicioMs, finMs, etapaActual],
  );

  // El eje cubre la serie y las franjas (el filtro no debe encoger el tiempo)
  const desdeMs = Math.min(serie.desdeMs, ...franjas.map((f) => f.desdeMs));
  const hastaMs = Math.max(serie.hastaMs, ...franjas.map((f) => f.hastaMs));

  const hayPuntos = serie.puntos.some((p) => p.valor !== null);
  const unidad = META[variable]?.unidad ?? "";
  const hayExtremos = serie.puntos.some((p) => p.confianza === "saturado" || p.confianza === "fuera_de_operacion");

  const interruptor = deQuimico ? null : (
    <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <input type="checkbox" checked={soloMonitoreadas}
        onChange={(e) => setSoloMonitoreadas(e.target.checked)} />
      Solo etapas monitoreadas
    </label>
  );

  if (!hayPuntos) {
    return (
      <div>
        {interruptor}
        <p className="text-sm text-slate-500">
          {soloMonitoreadas && lecturas.length > 0
            ? "Sin lecturas en etapas monitoreadas todavía. Desmarca el filtro para ver todas."
            : "Sin datos todavía."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {interruptor}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={serie.puntos} margin={{ top: 18, right: 24, bottom: 4, left: 0 }}>
          {franjas.map((f, i) => (
            <ReferenceArea key={`${f.etapa}-${i}`} x1={f.desdeMs} x2={f.hastaMs} ifOverflow="hidden"
              fill={ETAPAS_MONITOREADAS.includes(f.etapa) ? COLOR_MONITOREADA : COLOR_NO_MONITOREADA}
              fillOpacity={0.35} stroke="none"
              label={{ value: ETAPA_LABEL[f.etapa] ?? f.etapa, position: "insideTop", fontSize: 9, fill: "#64748b" }} />
          ))}
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="t" type="number" scale="time" domain={[desdeMs, hastaMs]}
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
            dot={Punto} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500">
        {hayExtremos && "◯ saturado (el valor real es mayor) · × fuera de operación (dato no confiable). "}
        {serie.huecos > 0 && `${serie.huecos} corte${serie.huecos === 1 ? "" : "s"} de línea: hueco entre lecturas. `}
        Franjas: etapa de cada lectura, con límites aproximados (azul monitoreada, ámbar no monitoreada).
        Eje de tiempo proporcional desde el inicio del ciclo.
      </p>
    </div>
  );
}
