"use client";
import { C } from "./svgTokens";

const W = 260;
const H = 64;
const MAX = 45; // deja ver el límite de drenaje (40 NTU) dentro del gráfico

export default function MiniTrendChart({
  datos, limite,
}: { datos: number[]; limite: number }) {
  const y = (v: number) => H - (Math.min(v, MAX) / MAX) * (H - 6) - 3;
  const x = (i: number) => (i / Math.max(datos.length - 1, 1)) * W;
  const puntos = datos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `0,${H} ${puntos} ${W},${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H}
      role="img" aria-label="Tendencia de turbidez de los últimos 12 minutos">
      <line x1="0" y1={y(limite)} x2={W} y2={y(limite)}
        stroke={C.muted} strokeWidth="1" strokeDasharray="3 4" />
      <polygon points={area} fill={C.green} opacity="0.12" />
      <polyline points={puntos} fill="none" stroke={C.green} strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(datos.length - 1)} cy={y(datos[datos.length - 1])} r="2.6"
        fill={C.green} />
    </svg>
  );
}
