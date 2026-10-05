"use client";
import { returnQuality } from "@/lib/mock-cip";
import MiniTrendChart from "./MiniTrendChart";

export default function ReturnQualityCard({
  turbidez, conductividad, historia,
}: { turbidez: number; conductividad: number; historia: number[] }) {
  return (
    <section className="cip-panel">
      <div className="cip-panel-head">
        <h2>Calidad del retorno</h2>
        <span className="cip-spacer cip-micro">TU-01 · CT-02</span>
      </div>

      <div className="cip-pair">
        <div>
          <div className="cip-micro">Turbidez</div>
          <div className="cip-pair-value cip-mono">{turbidez.toFixed(0)}<small>NTU</small></div>
        </div>
        <div>
          <div className="cip-micro">Conductividad</div>
          <div className="cip-pair-value cip-mono">
            {conductividad.toFixed(1)}<small>mS/cm</small>
          </div>
        </div>
      </div>

      <div className="cip-trend">
        <div className="cip-micro">Turbidez · últimos 12 min</div>
        <MiniTrendChart datos={historia} limite={returnQuality.drainLimit} />
        <div className="cip-trend-axis">
          <span>−12 min</span>
          <span>límite drenaje: {returnQuality.drainLimit} NTU</span>
          <span>ahora</span>
        </div>
      </div>

      <div className="cip-note">
        <div className="cip-note-title">
          <span className="cip-dot" />Recirculando
        </div>
        <p>La solución sigue útil: vuelve al estanque de soda y se reutiliza.</p>
      </div>
    </section>
  );
}
