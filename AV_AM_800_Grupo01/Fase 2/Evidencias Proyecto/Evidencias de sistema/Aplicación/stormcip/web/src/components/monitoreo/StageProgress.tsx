"use client";
import { stages } from "@/lib/mock-cip";

export default function StageProgress({
  etapaActiva, progreso,
}: { etapaActiva: number; progreso: number }) {
  const cols = { gridTemplateColumns: `repeat(${stages.length}, 1fr)` };
  const activa = etapaActiva - 1; // la etapa viene 1-based

  return (
    <>
      <div className="cip-stage-bar" style={cols}>
        {stages.map((s, i) => (
          <div key={s}
            className={`cip-stage-seg${i < activa ? " done" : ""}`}>
            {i === activa && <i style={{ width: `${progreso}%` }} />}
          </div>
        ))}
      </div>
      <div className="cip-stage-labels" style={cols}>
        {stages.map((s, i) => (
          <span key={s} className={i === activa ? "is-active" : undefined}>{s}</span>
        ))}
      </div>
    </>
  );
}
