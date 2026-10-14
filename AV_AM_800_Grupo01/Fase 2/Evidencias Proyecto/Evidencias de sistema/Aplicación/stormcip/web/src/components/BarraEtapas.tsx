"use client";
import { ETAPA_LABEL, EstadoProceso } from "@/lib/tipos";
import {
  estadoEtapas, formatearDuracion, procesoDelCiclo, segundosDelCiclo, segundosEnEtapa,
} from "@/lib/etapas";

type CicloBarra = {
  id: string; etapaActual?: string; estado?: string; inicio?: any; fin?: any;
};

// Etapas del ciclo con el cronómetro. Solo tiempo transcurrido: no hay una fuente
// real de duraciones por etapa, así que no se muestra tiempo restante.
export default function BarraEtapas({
  ciclo, proceso, detenido, ahora,
}: {
  ciclo: CicloBarra; proceso: EstadoProceso | null; detenido: boolean; ahora: number;
}) {
  const etapas = estadoEtapas(ciclo.etapaActual, ciclo.estado);
  const delCiclo = segundosDelCiclo(ciclo.inicio, ciclo.fin, ahora);
  const enEtapa = segundosEnEtapa(ciclo, proceso, detenido, ahora);
  const simulado = procesoDelCiclo(proceso, ciclo.id)?.simulado === true;
  const enCurso = ciclo.estado === "en_curso";

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {etapas.map(({ etapa, estado }, i) => (
          <li key={etapa} className="flex items-center gap-2">
            <span
              aria-current={estado === "actual" ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${
                estado === "actual"
                  ? "border-blue-500 bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : estado === "hecha"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
              {estado === "hecha" && "✓ "}{ETAPA_LABEL[etapa] ?? etapa}
            </span>
            {i < etapas.length - 1 && <span aria-hidden className="text-slate-300">›</span>}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <span><b>{enCurso ? "Tiempo del ciclo:" : "Duración del ciclo:"}</b>{" "}
          <span className="tabular-nums">{formatearDuracion(delCiclo)}</span></span>
        {enCurso && (
          <span><b>En esta etapa:</b>{" "}
            {enEtapa === null
              ? <span className="text-slate-500">sin dato</span>
              : <span className="tabular-nums">{formatearDuracion(enEtapa)}{simulado && " (simulado)"}</span>}
          </span>
        )}
      </div>
      {enCurso && enEtapa === null && (
        <p className="mt-1 text-xs text-slate-500">
          El ciclo no registra cuándo empezó cada etapa; el tiempo en la etapa solo se
          conoce con el estado de planta vigente.
        </p>
      )}
    </section>
  );
}
