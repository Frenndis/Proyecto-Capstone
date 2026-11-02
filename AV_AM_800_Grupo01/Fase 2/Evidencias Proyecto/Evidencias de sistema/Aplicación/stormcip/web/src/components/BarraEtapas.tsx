"use client";
import { ETAPA_LABEL, EstadoProceso, MarcaTiempo } from "@/lib/tipos";
import {
  estadoEtapas, formatearDuracion, segundosDelCiclo, segundosEnEtapa,
  segundosRestantesCiclo, segundosRestantesEtapa,
} from "@/lib/etapas";

type CicloBarra = {
  id: string; etapaActual?: string; estado?: string; inicio?: MarcaTiempo | null; fin?: MarcaTiempo | null;
};

function Tiempo({ etiqueta, segundos }: { etiqueta: string; segundos: number | null }) {
  return (
    <div>
      <p className="sc-eyebrow">{etiqueta}</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
        {segundos === null ? <span className="text-sm font-normal text-ink-3">sin dato</span> : formatearDuracion(segundos)}
      </p>
    </div>
  );
}

// Fases del ciclo con el cronómetro. El tiempo transcurrido del ciclo sale de su
// inicio; el tiempo en la etapa y el restante, solo de estadoProceso (el ciclo no
// guarda cuándo empezó cada etapa). Sin estado de planta vigente: "sin dato".
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
  const enCurso = ciclo.estado === "en_curso";

  return (
    <section className="sc-card p-4">
      <ol className="grid grid-cols-3 gap-x-1 gap-y-3 md:grid-cols-6">
        {etapas.map(({ etapa, estado, monitoreada }) => (
          <li key={etapa} aria-current={estado === "actual" ? "step" : undefined}
            title={monitoreada ? undefined : "No monitoreada: las sondas WQS no miden dentro de su rango en esta etapa"}>
            <span className={`mb-1.5 block truncate text-xs ${
              estado === "actual" ? "font-semibold text-ink" : estado === "hecha" ? "text-ink-2" : "text-ink-3"}`}>
              {ETAPA_LABEL[etapa] ?? etapa}
            </span>
            <span className={`block h-1 ${monitoreada ? "" : "opacity-60"} ${
              estado === "actual" ? "bg-accent" : estado === "hecha" ? "bg-brand" : "bg-line"}`} />
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        <Tiempo etiqueta={enCurso ? "Tiempo del ciclo" : "Duración del ciclo"} segundos={delCiclo} />
        {enCurso && (
          <>
            <Tiempo etiqueta="En esta etapa" segundos={enEtapa} />
            <Tiempo etiqueta="Restante de la etapa" segundos={restanteEtapa} />
            <Tiempo etiqueta="Restante del ciclo" segundos={restanteCiclo} />
          </>
        )}
      </div>
    </section>
  );
}
