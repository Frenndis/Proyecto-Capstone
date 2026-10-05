"use client";
import type { SensorKpi } from "@/lib/mock-cip";

const TONO: Record<string, string> = {
  "EN RANGO": "cip-tag",
  RECIRCULABLE: "cip-tag cip-tag-cyan",
  ATENCION: "cip-tag cip-tag-yellow",
  "FUERA DE RANGO": "cip-tag cip-tag-red",
};

export default function SensorKpiCard({ sensor }: { sensor: SensorKpi }) {
  const atencion = sensor.status === "ATENCION" || sensor.status === "FUERA DE RANGO";
  return (
    <article className={`cip-kpi${atencion ? " is-warn" : ""}`}>
      <div className="cip-kpi-head">
        <span className="cip-micro">{sensor.label}</span>
        <span className="cip-kpi-code cip-mono">{sensor.code}</span>
      </div>
      <div className="cip-kpi-value cip-mono">
        {sensor.value.toFixed(sensor.decimals)}
        {sensor.unit && <small>{sensor.unit}</small>}
      </div>
      <div className="cip-kpi-foot">
        <span className="cip-mono">{sensor.target}</span>
        <span className={`cip-spacer ${TONO[sensor.status] ?? "cip-tag"}`}>{sensor.status}</span>
      </div>
    </article>
  );
}
