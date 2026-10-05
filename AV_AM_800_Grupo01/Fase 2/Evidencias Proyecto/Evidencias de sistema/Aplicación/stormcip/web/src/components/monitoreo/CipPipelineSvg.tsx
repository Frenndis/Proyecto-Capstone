"use client";
import { C, MONO } from "./svgTokens";

// Geometría del P&ID simplificado. Centro de cada bajada de estanque y alturas
// de los colectores: todo lo demás se deriva de estas constantes.
const IDA_Y = 400;      // colector de impulsión
const RET_Y = 470;      // colector de retorno
const RISER_X = 720;    // subida hacia el camión
const TOP_Y = 300;      // tramo horizontal hacia el camión
const TRUCK_IN_X = 898;
const TRUCK_OUT_X = 940;
const TRUCK_BOTTOM = 252;
const TANK_OUT_Y = 318;  // bajo la insignia de estado del estanque

const SENSORES_IDA = [
  { x: 752, code: "FT", label: "CAUDAL" },
  { x: 796, code: "TT", label: "TEMP." },
  { x: 840, code: "CT", label: "CONDUCT." },
];

const SENSORES_RET = [
  { x: 766, code: "TU" },
  { x: 812, code: "CT" },
];

function Sensor({ x, y, code, color }: { x: number; y: number; code: string; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="13" fill={C.panel} stroke={color} strokeWidth="1.3" />
      <text x={x} y={y + 3.5} textAnchor="middle" fill={color} fontSize="9"
        fontFamily={MONO}>{code}</text>
    </g>
  );
}

export default function CipPipelineSvg({
  bajadas,
}: { bajadas: { x: number; activa: boolean }[] }) {
  const [t1] = bajadas;
  return (
    <g>
      <defs>
        <marker id="cip-ar-ida" markerWidth="7" markerHeight="7" refX="5.5" refY="3"
          orient="auto"><path d="M0 0 L6 3 L0 6 z" fill={C.line} /></marker>
        <marker id="cip-ar-ret" markerWidth="7" markerHeight="7" refX="5.5" refY="3"
          orient="auto"><path d="M0 0 L6 3 L0 6 z" fill={C.green} /></marker>
      </defs>

      {/* bajadas de los estanques al colector de impulsión */}
      {bajadas.map((b) => (
        <line key={b.x} x1={b.x} y1={TANK_OUT_Y} x2={b.x} y2={IDA_Y}
          stroke={b.activa ? C.line : C.muted} strokeWidth={b.activa ? 2 : 1.3}
          strokeDasharray={b.activa ? undefined : "4 4"} />
      ))}
      <line x1={t1.x} y1={IDA_Y} x2={640} y2={IDA_Y} stroke={C.line} strokeWidth="2" />

      {/* retorno: del camión al colector de retorno y de vuelta al estanque de soda */}
      <line x1={TRUCK_OUT_X} y1={TRUCK_BOTTOM} x2={TRUCK_OUT_X} y2={RET_Y}
        stroke={C.green} strokeWidth="2" />
      <line x1={TRUCK_OUT_X} y1={RET_Y} x2={t1.x + 32} y2={RET_Y}
        stroke={C.green} strokeWidth="2" />
      <line x1={t1.x + 32} y1={RET_Y} x2={t1.x + 32} y2={IDA_Y + 4}
        stroke={C.green} strokeWidth="2" markerEnd="url(#cip-ar-ret)" />
      <text x={t1.x + 42} y={IDA_Y - 6} fill={C.green} fontSize="8" letterSpacing="1.1"
        fontFamily={MONO}>VUELVE AL MISMO ESTANQUE</text>
      <text x={560} y={RET_Y - 8} fill={C.green} fontSize="8" letterSpacing="1.1"
        fontFamily={MONO}>RETORNO · RECIRCULACIÓN A SODA</text>

      {/* drenaje cerrado */}
      <line x1={520} y1={IDA_Y} x2={520} y2={530} stroke={C.muted} strokeWidth="1.3"
        strokeDasharray="3 5" />
      <text x={530} y={528} fill={C.muted} fontSize="8" letterSpacing="1.1"
        fontFamily={MONO}>DRENAJE / RIL · CERRADO</text>

      {/* válvula de 3 vías */}
      <path d={`M568 ${IDA_Y - 11} L568 ${IDA_Y + 11} L583 ${IDA_Y} Z`}
        fill={C.panel} stroke={C.line} strokeWidth="1.3" />
      <path d={`M598 ${IDA_Y - 11} L598 ${IDA_Y + 11} L583 ${IDA_Y} Z`}
        fill={C.panel} stroke={C.line} strokeWidth="1.3" />
      <text x={583} y={IDA_Y + 26} textAnchor="middle" fill={C.muted} fontSize="8"
        letterSpacing="1.1" fontFamily={MONO}>V-04 · 3 VÍAS</text>

      {/* bomba */}
      <circle cx={658} cy={IDA_Y} r="17" fill="#0e3550" stroke={C.cyan} strokeWidth="1.6" />
      <path d={`M652 ${IDA_Y - 7} L668 ${IDA_Y} L652 ${IDA_Y + 7} Z`} fill={C.cyan} />
      <text x={680} y={IDA_Y - 2} fill={C.secondary} fontSize="8" letterSpacing="1.1"
        fontFamily={MONO}>P-01 · BOMBA</text>
      <text x={680} y={IDA_Y + 10} fill={C.muted} fontSize="8"
        fontFamily={MONO}>2.8 bar · 1480 RPM</text>

      {/* impulsión hacia el camión */}
      <polyline
        points={`675,${IDA_Y} ${RISER_X},${IDA_Y} ${RISER_X},${TOP_Y} ${TRUCK_IN_X},${TOP_Y} ${TRUCK_IN_X},${TRUCK_BOTTOM + 6}`}
        fill="none" stroke={C.line} strokeWidth="2" markerEnd="url(#cip-ar-ida)" />
      <text x={RISER_X + 8} y={TOP_Y - 10} fill={C.secondary} fontSize="8"
        letterSpacing="1.1" fontFamily={MONO}>SOLUCIÓN DE LIMPIEZA</text>

      {/* instrumentación de la línea de impulsión */}
      {SENSORES_IDA.map((s) => (
        <g key={s.code + s.x}>
          <Sensor x={s.x} y={TOP_Y} code={s.code} color={C.cyan} />
          <text x={s.x} y={TOP_Y + 27} textAnchor="middle" fill={C.muted} fontSize="7"
            letterSpacing="0.8" fontFamily={MONO}>{s.label}</text>
        </g>
      ))}

      {/* instrumentación del retorno */}
      {SENSORES_RET.map((s) => (
        <Sensor key={s.code + s.x} x={s.x} y={RET_Y} code={s.code} color={C.green} />
      ))}
      <text x={789} y={RET_Y + 27} textAnchor="middle" fill={C.muted} fontSize="7"
        letterSpacing="0.8" fontFamily={MONO}>TURBIDEZ · CONCENTRACIÓN</text>
    </g>
  );
}
