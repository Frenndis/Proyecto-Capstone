"use client";
import { C, MONO, SANS } from "./svgTokens";

// Camión cisterna simplificado. Coordenadas locales; el grupo se posiciona desde
// el diagrama (origen en la esquina superior izquierda del estanque).
export default function TruckTankSvg({
  x, y, patente, anden,
}: { x: number; y: number; patente: string; anden: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text x="0" y="-10" fill={C.muted} fontSize="8" letterSpacing="1.2"
        fontFamily={MONO}>{patente} · {anden}</text>

      {/* chasis y ejes */}
      <line x1="10" y1="104" x2="290" y2="104" stroke={C.secondary} strokeWidth="1.5" />
      <circle cx="60" cy="116" r="12" fill={C.bgNode} stroke={C.secondary} strokeWidth="1.5" />
      <circle cx="92" cy="116" r="12" fill={C.bgNode} stroke={C.secondary} strokeWidth="1.5" />
      <circle cx="268" cy="116" r="12" fill={C.bgNode} stroke={C.secondary} strokeWidth="1.5" />

      {/* cabina */}
      <path d="M238 100 L238 56 L268 56 L284 76 L284 100 Z"
        fill={C.bgNode} stroke={C.secondary} strokeWidth="1.5" />
      <path d="M252 60 L268 60 L278 76 L252 76 Z" fill="none" stroke={C.border} />

      {/* estanque */}
      <rect x="0" y="0" width="236" height="92" rx="46"
        fill={C.bgNode} stroke={C.text} strokeWidth="1.8" />
      <line x1="46" y1="6" x2="46" y2="86" stroke={C.border} />
      <line x1="190" y1="6" x2="190" y2="86" stroke={C.border} />

      {/* boquillas de lavado */}
      <circle cx="118" cy="22" r="5" fill="none" stroke={C.cyan} strokeWidth="1.2" />
      {[-26, -9, 9, 26].map((dx) => (
        <line key={dx} x1="118" y1="26" x2={118 + dx} y2="46"
          stroke={C.cyan} strokeWidth="1" opacity="0.55" strokeDasharray="2 3" />
      ))}

      <text x="118" y="60" textAnchor="middle" fill={C.text} fontSize="11"
        fontWeight="600" fontFamily={SANS}>Estanque del camión</text>
      <text x="118" y="75" textAnchor="middle" fill={C.muted} fontSize="8"
        letterSpacing="1" fontFamily={MONO}>LAVADO INTERIOR · SIN DESARMAR</text>
    </g>
  );
}
