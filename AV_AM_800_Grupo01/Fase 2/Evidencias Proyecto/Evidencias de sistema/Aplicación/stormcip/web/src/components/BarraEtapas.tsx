"use client";
import { ETAPA_LABEL, EstadoProceso } from "@/lib/tipos";
import {
  estadoEtapas, formatearDuracion, procesoDelCiclo, segundosDelCiclo, segundosEnEtapa,
  segundosRestantesCiclo, segundosRestantesEtapa,
} from "@/lib/etapas";

type CicloBarra = {
  id: string; etapaActual?: string; estado?: string; inicio?: any; fin?: any;
};

function Tiempo({ etiqueta, segundos, marca }: { etiqueta: string; segundos: number | null; marca?: string }) {
  return (
    <span><b>{etiqueta}:</b>{" "}
      {segundos === null
        ? <span className="text-slate-500">sin dato</span>
        : <span className="tabular-nums">{formatearDuracion(segundos)}
            {marca && <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">{marca}</span>}
          </span>}
    </span>
  );
}

// Etapas del ciclo con el cronómetro. El tiempo transcurrido del ciclo sale de su
// inicio; el tiempo en la etapa y el restante, solo de estadoProceso (el ciclo no
// guarda cuándo empezó ni cuánto dura cada etapa), y se marcan SIMULADO mientras
// ese documento lo sea. Sin estado de planta vigente: "sin dato".
export default function BarraEtapas({
  ciclo, proceso, detenido, ahora,
}: {
  ciclo: CicloBarra; proceso: EstadoProceso | null; detenido: boolean; ahora: number;
}) {
  const etapas = estadoEtapas(ciclo.etapaActual, ciclo.estado);
  const delCiclo = segundosDelCiclo(ciclo.inicio, ciclo.fin, ahora);
  const enEtapa = segundosEnEtapa(ciclo, proceso, detenido, ahora);
  const restanteEtapa = segundosRestantesEtapa(ciclo, proceso, detenido, ahora);
  const restanteCiclo = segundosRestantesCiclo(ciclo, proceso, detenido, ahora);
  const simulado = procesoDelCiclo(proceso, ciclo.id)?.simulado === true;
  const marca = simulado ? "simulado" : undefined;
  const enCurso = ciclo.estado === "en_curso";

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {etapas.map(({ etapa, estado, monitoreada }, i) => (
          <li key={etapa} className="flex items-center gap-2">
            <span
              aria-current={estado === "actual" ? "step" : undefined}
              title={monitoreada ? undefined : "No monitoreada: las sondas WQS no miden dentro de su rango en esta etapa"}
              className={`rounded-full border px-3 py-1 ${monitoreada ? "" : "border-dashed"} ${
                estado === "actual"
                  ? "border-blue-500 bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : estado === "hecha"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
              {estado === "hecha" && "✓ "}{ETAPA_LABEL[etapa] ?? etapa}
              {!monitoreada && <span className="ml-1.5 text-[10px] font-normal opacity-80">no monitoreada</span>}
            </span>
            {i < etapas.length - 1 && <span aria-hidden className="text-slate-300">›</span>}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <Tiempo etiqueta={enCurso ? "Tiempo del ciclo" : "Duración del ciclo"} segundos={delCiclo} />
        {enCurso && (
          <>
            <Tiempo etiqueta="En esta etapa" segundos={enEtapa} marca={marca} />
            <Tiempo etiqueta="Restante de la etapa" segundos={restanteEtapa} marca={marca} />
            <Tiempo etiqueta="Restante del ciclo" segundos={restanteCiclo} marca={marca} />
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Borde punteado: etapa no monitoreada (las sondas WQS no miden dentro de su rango, así
        que no hay tendencia ni indicadores).
        {enCurso && " Los tiempos por etapa y el restante vienen del estado de planta, no del ciclo."}
      </p>
    </section>
  );
}
