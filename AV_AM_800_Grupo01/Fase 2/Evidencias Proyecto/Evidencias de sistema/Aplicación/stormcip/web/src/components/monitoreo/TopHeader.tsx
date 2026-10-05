"use client";
import { useEffect, useState } from "react";

// El reloj parte vacío y se llena recién en el cliente: renderizar la hora en el
// HTML exportado provocaría un desajuste de hidratación en cada carga.
export default function TopHeader() {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    setAhora(new Date());
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fecha = ahora
    ? ahora.toLocaleDateString("es-CL", {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
      }).replace(/\./g, "")
    : "—";
  const hora = ahora ? ahora.toLocaleTimeString("es-CL", { hour12: false }) : "--:--:--";

  return (
    <header className="cip-header">
      <div className="cip-breadcrumb">
        StormCIP&nbsp; / &nbsp;<b>Monitoreo en vivo</b>
      </div>
      <div className="cip-header-right">
        <span className="cip-header-date">{fecha}</span>
        <span className="cip-clock cip-mono">{hora}</span>
        <span className="cip-chip">
          <span className="cip-dot" />
          Ciclo en curso
        </span>
      </div>
    </header>
  );
}
