"use client";
import { formatoReloj, mockCycle } from "@/lib/mock-cip";
import StageProgress from "./StageProgress";

export default function CycleSummary({ transcurrido }: { transcurrido: number }) {
  return (
    <section className="cip-panel cip-summary">
      <div>
        <div className="cip-micro">Ciclo en curso</div>
        <div className="cip-cycle-id cip-mono">{mockCycle.id}</div>
        <div className="cip-cycle-meta">
          <span><span className="cip-k">Camión</span> <b className="cip-mono">{mockCycle.truck}</b></span>
          <span><span className="cip-k">Programa</span> <b>{mockCycle.program}</b></span>
          <span><span className="cip-k">Inicio</span> <b className="cip-mono">{mockCycle.startTime}</b></span>
        </div>
      </div>

      <div>
        <div className="cip-stage-head">
          <h3>Etapa {mockCycle.stage} · {mockCycle.stageName}</h3>
          <span className="cip-mono">{mockCycle.stageDetail}</span>
          <span className="cip-stage-pct">{mockCycle.stageProgress}% de la etapa</span>
        </div>
        <StageProgress etapaActiva={mockCycle.stage} progreso={mockCycle.stageProgress} />
      </div>

      <div className="cip-timers">
        <div>
          <div className="cip-micro">Transcurrido</div>
          <div className="cip-timer-value cip-mono">{formatoReloj(transcurrido)}</div>
        </div>
        <div>
          <div className="cip-micro">Restante est.</div>
          <div className="cip-timer-value cip-mono">
            {mockCycle.remainingMinutes}<small>min</small>
          </div>
        </div>
      </div>
    </section>
  );
}
