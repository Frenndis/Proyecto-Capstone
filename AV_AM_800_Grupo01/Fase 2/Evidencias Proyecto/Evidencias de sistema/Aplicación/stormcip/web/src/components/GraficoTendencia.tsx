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
const EJE = { fontSize: 10.5, fill: "#8CA1B8", fontFamily: "IBM Plex Mono, monospace" };
const COLOR_MONITOREADA = "#12223A";
const COLOR_NO_MONITOREADA = "#2b2413";

// Un punto por lectura. Los saturados (cota inferior: el valor real es mayor) y
// los fuera de operación (dato no confiable) se dibujan distinto del medido.
function Punto({ cx, cy, payload }: { cx?: number; cy?: number; payload?: PuntoSerie }) {
  if (cx === undefined || cy === undefined || !payload || payload.valor === null) return <g />;
  if (payload.confianza === "saturado") {
    return <circle cx={cx} cy={cy} r={4} fill="#0E1B2E" stroke="#D9A13B" strokeWidth={2} />;
  }
  if (payload.confianza === "fuera_de_operacion") {
    return (
      <g stroke="#8CA1B8" strokeWidth={2}>
        <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} />
        <line x1={cx - 3.5} y1={cy + 3.5} x2={cx + 3.5} y2={cy - 3.5} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={2.5} fill="#2FB7E8" />;
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
    <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-ink-2">
      <input type="checkbox" checked={soloMonitoreadas}
        onChange={(e) => setSoloMonitoreadas(e.target.checked)} />
      Solo etapas monitoreadas
    </label>
  );

  if (!hayPuntos) {
    return (
      <div>
        {interruptor}
        <p className="text-sm text-ink-3">
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
              label={{ value: ETAPA_LABEL[f.etapa] ?? f.etapa, position: "insideTop", fontSize: 9.5, fill: "#8CA1B8" }} />
          ))}
          <CartesianGrid stroke="#1D3049" />
          <XAxis dataKey="t" type="number" scale="time" domain={[desdeMs, hastaMs]}
            tickFormatter={hora} tick={EJE} tickLine={false} axisLine={{ stroke: "#2A415E" }} minTickGap={40} />
          <YAxis tick={EJE} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} />
          <Tooltip contentStyle={{ background: "#0E1B2E", border: "1px solid #2A415E", borderRadius: 4, fontSize: 12 }} labelFormatter={(t) => hora(Number(t))}
            formatter={(v) => [`${formatear(variable, Number(v))} ${unidad}`.trim(), META[variable]?.label ?? variable]} />
          {/* Los umbrales dibujados hacen legible la caída del enjuague. ifOverflow
              extiende el eje Y para que la línea del umbral siempre se vea. */}
          {rango?.max !== undefined && (
            <ReferenceLine y={rango.max} stroke="#E86A5E" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: `Alerta > ${rango.max}`, position: "insideTopRight", fontSize: 10, fill: "#E86A5E" }} />
          )}
          {rango?.min !== undefined && (
            <ReferenceLine y={rango.min} stroke="#E86A5E" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: `Alerta < ${rango.min}`, position: "insideBottomRight", fontSize: 10, fill: "#E86A5E" }} />
          )}
          <Line type="linear" dataKey="valor" stroke="#2FB7E8" strokeWidth={1.75}
            dot={Punto} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-ink-3">
        {hayExtremos && "◯ saturado (el valor real es mayor) · × fuera de operación (dato no confiable). "}
        {serie.huecos > 0 && `${serie.huecos} corte${serie.huecos === 1 ? "" : "s"} de línea: hueco entre lecturas. `}
        Franjas: etapa de cada lectura, con límites aproximados (azul monitoreada, ámbar no monitoreada).
        Eje de tiempo proporcional desde el inicio del ciclo.
      </p>
    </div>
  );
}
