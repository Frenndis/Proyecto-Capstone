"use client";
import { mockCycle, tanks } from "@/lib/mock-cip";
import CipPipelineSvg from "./CipPipelineSvg";
import TankSvg from "./TankSvg";
import TruckTankSvg from "./TruckTankSvg";
import { C, MONO } from "./svgTokens";

const TANQUE_X = [70, 215, 360];
const TANQUE_Y = 95;
const SECCIONES = [
  { x: 70, t: "PREPARACIÓN DE LA SOLUCIÓN" },
  { x: 560, t: "IMPULSIÓN Y MEDICIÓN" },
  { x: 850, t: "LAVADO DEL CAMIÓN" },
];

// La bajada del estanque en servicio sale desplazada a la izquierda para dejarle
// sitio a la subida del retorno dentro del mismo estanque.
const BAJADAS = [
  { x: TANQUE_X[0] + 40, activa: true },
  { x: TANQUE_X[1] + 56, activa: false },
  { x: TANQUE_X[2] + 56, activa: false },
];

export default function ProcessDiagramPanel() {
  return (
    <section className="cip-panel">
      <div className="cip-panel-head">
        <h2>Circuito en tiempo real</h2>
        <span className="cip-tag cip-tag-cyan">Recirculando a soda</span>
        <span className="cip-spacer cip-micro">P&amp;ID simplificado · {mockCycle.line}</span>
      </div>

      <div className="cip-diagram">
        <svg viewBox="0 0 1180 560" role="img"
          aria-label="Diagrama del circuito CIP: estanques, bomba, válvula, sensores y camión cisterna">
          {SECCIONES.map((s) => (
            <text key={s.t} x={s.x} y="30" fill={C.muted} fontSize="9"
              letterSpacing="1.4" fontFamily={MONO}>{s.t}</text>
          ))}

          <CipPipelineSvg bajadas={BAJADAS} />

          {tanks.map((t, i) => (
            <TankSvg key={t.key} x={TANQUE_X[i]} y={TANQUE_Y}
              name={t.name} level={t.level} levelTag={t.levelTag}
              lines={t.lines} status={t.status} tone={t.tone} />
          ))}

          <TruckTankSvg x={850} y={160} patente={mockCycle.truck} anden={mockCycle.dock} />
        </svg>
      </div>

      <div className="cip-legend">
        <span><i className="l-ida" />Ida: solución al camión</span>
        <span><i className="l-ret" />Retorno y recirculación</span>
        <span><i className="l-dre" />Drenaje (cerrado)</span>
        <span className="cip-spacer">
          Sensores: FT caudal · TT temp · CT conduct. · TU turbidez · LT nivel
        </span>
      </div>
    </section>
  );
}
