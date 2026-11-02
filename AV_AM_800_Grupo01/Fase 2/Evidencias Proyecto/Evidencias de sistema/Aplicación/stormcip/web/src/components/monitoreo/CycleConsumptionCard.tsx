"use client";
import { consumption, mockCycle } from "@/lib/mock-cip";

const COLOR: Record<string, string> = {
  cyan: "var(--cyan)",
  green: "var(--green)",
  yellow: "var(--yellow)",
  magenta: "var(--magenta)",
};

export default function CycleConsumptionCard() {
  return (
    <section className="cip-panel">
      <div className="cip-panel-head">
        <h2>Consumo del ciclo</h2>
        <span className="cip-spacer cip-micro cip-mono">{mockCycle.id}</span>
      </div>
      <div className="cip-consumo">
        {consumption.map((c) => (
          <div key={c.label} className="cip-consumo-row">
            <span className="sw" style={{ background: COLOR[c.tone] }} />
            <span>{c.label}</span>
            <span className="v cip-mono">{c.value}</span>
            <span className="u cip-mono">{c.unit}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
