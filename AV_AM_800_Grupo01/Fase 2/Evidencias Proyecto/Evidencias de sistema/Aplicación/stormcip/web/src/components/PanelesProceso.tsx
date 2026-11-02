"use client";
import { EstadoProceso, formatear } from "@/lib/tipos";
import { ETIQUETA_ORIGEN, ETIQUETA_RETORNO, procesoDelCiclo } from "@/lib/etapas";

function Dato({ etiqueta, valor, unidad }: { etiqueta: string; valor: string; unidad?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-ink-3">{etiqueta}</span>
      <span className="font-medium font-mono tabular-nums">
        {valor}{unidad && <span className="ml-1 text-xs font-normal text-ink-3">{unidad}</span>}
      </span>
    </div>
  );
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-ctrl border border-line p-3">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
      {children}
    </div>
  );
}

// Estado de planta (lo que vendría del PLC) de estadoProceso/{lineaId}. Hoy lo
// escribe el simulador: la insignia lo dice mientras `simulado` sea true, para
// que nadie lo tome por telemetría de la planta real.
export default function PanelesProceso({
  cicloId, proceso, cargando, detenido,
}: {
  cicloId: string; proceso: EstadoProceso | null; cargando: boolean; detenido: boolean;
}) {
  const p = procesoDelCiclo(proceso, cicloId);

  const insignia = p
    ? (p.simulado
        ? <span className="rounded-ctrl bg-warn/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-warn">Simulado</span>
        : <span className="rounded-ctrl bg-raise px-2 py-0.5 text-[10px] uppercase text-ink-2">{p.fuente}</span>)
    : null;

  return (
    <section className="sc-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="sc-eyebrow">Estado de planta</h2>
        {insignia}
        {p && detenido && (
          <span className="rounded-ctrl bg-crit/10 px-2 py-0.5 text-[10px] text-crit">
            sin señal
          </span>
        )}
      </div>

      {cargando ? (
        <p className="text-sm text-ink-3">Leyendo estado de planta…</p>
      ) : !p ? (
        <p className="rounded-ctrl border border-dashed border-line p-3 text-sm text-ink-3">
          Sin estado de planta para este ciclo. Lo escribe el PLC o, en la demo, el simulador.
        </p>
      ) : (
        <div className={`grid gap-3 ${detenido ? "opacity-50" : ""}`}>
          <Panel titulo="Estanques">
            <Dato etiqueta="Soda" valor={`${formatear("nivel", p.estanques.soda.nivel)} %`}
              unidad={`${formatear("tempProceso", p.estanques.soda.temp)} °C`} />
            <Dato etiqueta="Ácido" valor={`${formatear("nivel", p.estanques.acido.nivel)} %`}
              unidad={`${formatear("tempProceso", p.estanques.acido.temp)} °C`} />
            <Dato etiqueta="Agua recuperada" valor={`${formatear("nivel", p.estanques.aguaRecuperada.nivel)} %`} />
          </Panel>
          <Panel titulo="Circuito">
            <Dato etiqueta="Origen" valor={ETIQUETA_ORIGEN[p.circuito.origen] ?? p.circuito.origen} />
            <Dato etiqueta="Retorno" valor={ETIQUETA_RETORNO[p.circuito.destinoRetorno] ?? p.circuito.destinoRetorno} />
            <Dato etiqueta="Bomba" valor={p.circuito.bomba.encendida ? "Encendida" : "Apagada"}
              unidad={p.circuito.bomba.encendida ? `${p.circuito.bomba.rpm} rpm` : undefined} />
          </Panel>
        </div>
      )}
    </section>
  );
}
