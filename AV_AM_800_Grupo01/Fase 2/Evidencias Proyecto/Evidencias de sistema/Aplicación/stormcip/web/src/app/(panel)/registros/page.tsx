"use client";
import { useState } from "react";
import { useCiclosRecientes } from "@/hooks/useCiclos";
import { useHistorialAlertas } from "@/hooks/useDatosCip";
import IndicadoresCiclo from "@/components/IndicadoresCiclo";
import HistorialAlertas from "@/components/HistorialAlertas";
import { Estado, Simulado, Tarjeta, Vacio } from "@/components/ui/Sala";
import { duracionMin, estadoDeCiclo, formatoTiempo } from "@/lib/central";

const fecha = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate?.().toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) ?? "—";

export default function RegistrosPage() {
  const { ciclos, cargando } = useCiclosRecientes();
  const alertas = useHistorialAlertas();
  const [elegido, setElegido] = useState<string | null>(null);
  const ciclo = ciclos.find((c) => c.id === elegido);

  return (
    <div className="space-y-4">
      <Tarjeta titulo="Registros de ciclo" derecha={`${ciclos.length} ciclos · elige uno para ver su detalle`}>
        {ciclos.length === 0 ? <Vacio>{cargando ? "Leyendo ciclos…" : "Aún no hay ciclos registrados."}</Vacio> : (
          <div className="max-h-[52vh] overflow-auto">
            <table className="sc-table">
              <thead>
                <tr>
                  <th>Ciclo</th><th>Inicio</th><th>Línea</th><th>Programa</th><th>Camión</th>
                  <th className="text-right">Duración</th><th className="text-right">Hasta limpio</th>
                  <th className="text-right">Agua m³</th><th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {ciclos.map((c) => {
                  const min = duracionMin(c);
                  const limpio = c.indicadores?.tiempoHastaLimpio;
                  return (
                    <tr key={c.id} onClick={() => setElegido(c.id)} aria-selected={c.id === elegido}
                      className={`cursor-pointer transition-colors ${c.id === elegido ? "bg-raise" : "hover:bg-raise/50"}`}>
                      <td className="font-mono text-accent-ink">{c.id}</td>
                      <td className="font-mono">{fecha(c.inicio)}</td>
                      <td>{c.lineaId}</td>
                      <td>{c.programa}</td>
                      <td className="font-mono">{c.camion}</td>
                      <td className="num">{min === null ? "—" : `${min.toFixed(1).replace(".", ",")} min`}</td>
                      <td className="num">{typeof limpio === "number" ? formatoTiempo(limpio) : "—"}</td>
                      <td className="num">{c.consumos?.aguaTotal?.toFixed(2).replace(".", ",") ?? "—"}</td>
                      <td><Estado {...estadoDeCiclo(c)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {ciclo && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <b className="font-mono text-sm">{ciclo.id}</b>
            {ciclo.simulado && <Simulado />}
          </div>
          <IndicadoresCiclo ciclo={ciclo} />
        </div>
      )}

      <Tarjeta titulo="Historial de alertas">
        <div className="p-4"><HistorialAlertas alertas={alertas} /></div>
      </Tarjeta>
    </div>
  );
}
