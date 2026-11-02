"use client";
import { C, MONO, SANS, TONOS } from "./svgTokens";

const W = 112;
const H = 200;

export default function TankSvg({
  x, y, name, level, levelTag, lines, status, tone,
}: {
  x: number; y: number; name: string; level: number; levelTag: string;
  lines: string[]; status: string; tone: keyof typeof TONOS;
}) {
  const t = TONOS[tone];
  const hFill = Math.round((H - 4) * (level / 100));

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={W / 2} y={-13} textAnchor="middle" fill={C.text}
        fontSize="11" fontFamily={SANS}>{name}</text>

      <rect width={W} height={H} rx="4" fill={C.bgTank} stroke={t.stroke} strokeWidth="1.5" />
      <rect x="2" y={H - 2 - hFill} width={W - 4} height={hFill}
        fill={t.fill} opacity="0.85" />
      <line x1="2" y1={H - 2 - hFill} x2={W - 2} y2={H - 2 - hFill}
        stroke={t.stroke} strokeWidth="1" opacity="0.9" />

      <text x={W / 2} y="48" textAnchor="middle" fill={C.text}
        fontSize="24" fontWeight="600" fontFamily={MONO}>{level}%</text>
      <text x={W / 2} y="64" textAnchor="middle" fill={C.muted}
        fontSize="8" letterSpacing="1.2" fontFamily={MONO}>{levelTag}</text>

      {lines.map((l, i) => (
        <text key={l} x={W / 2} y={H - 34 + i * 14} textAnchor="middle"
          fill={t.stroke} fontSize="9" fontFamily={MONO}>{l}</text>
      ))}

      <rect x={W / 2 - 43} y={H + 14} width="86" height="19" rx="3"
        fill="none" stroke={C.border} />
      <text x={W / 2} y={H + 27} textAnchor="middle" fill={C.secondary}
        fontSize="8" letterSpacing="1.1" fontFamily={MONO}>{status}</text>
    </g>
  );
}
