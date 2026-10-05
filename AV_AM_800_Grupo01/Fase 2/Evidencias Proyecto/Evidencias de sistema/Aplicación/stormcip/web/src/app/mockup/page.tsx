"use client";
import "./monitoreo.css";
import Sidebar from "@/components/monitoreo/Sidebar";
import TopHeader from "@/components/monitoreo/TopHeader";
import CycleSummary from "@/components/monitoreo/CycleSummary";
import SensorKpiCard from "@/components/monitoreo/SensorKpiCard";
import ProcessDiagramPanel from "@/components/monitoreo/ProcessDiagramPanel";
import ReturnQualityCard from "@/components/monitoreo/ReturnQualityCard";
import CycleConsumptionCard from "@/components/monitoreo/CycleConsumptionCard";
import { useSimulacionCip } from "@/hooks/useSimulacionCip";
import { evaluar, mockCycle } from "@/lib/mock-cip";

export default function MonitoreoEnVivo() {
  const { valores, transcurrido, turbidez, conductividad, historia } = useSimulacionCip();

  return (
    <div className="cip-root">
      <Sidebar activo="vivo" />

      <div className="cip-main">
        <TopHeader />

        <div className="cip-content">
          <div className="cip-page-title">
            <h1>Monitoreo en vivo</h1>
            <p>Circuito CIP · {mockCycle.dock} · actualización cada 2 s</p>
          </div>

          <CycleSummary transcurrido={transcurrido} />

          <div className="cip-kpis">
            {valores.map((s) => (
              <SensorKpiCard key={s.key}
                sensor={{ ...s, status: evaluar(s, s.value) }} />
            ))}
          </div>

          <div className="cip-grid">
            <ProcessDiagramPanel />
            <div className="cip-col-right">
              <ReturnQualityCard turbidez={turbidez} conductividad={conductividad}
                historia={historia} />
              <CycleConsumptionCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
