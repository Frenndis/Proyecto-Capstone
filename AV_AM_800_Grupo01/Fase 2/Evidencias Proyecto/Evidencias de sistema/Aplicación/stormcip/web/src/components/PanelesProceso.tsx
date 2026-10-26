"use client";
import { EstadoProceso, formatear } from "@/lib/tipos";
import { ETIQUETA_ORIGEN, ETIQUETA_RETORNO, procesoDelCiclo } from "@/lib/etapas";

function Dato({ etiqueta, valor, unidad }: { etiqueta: string; valor: string; unidad?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-slate-500">{etiqueta}</span>
      <span className="font-medium tabular-nums">
        {valor}{unidad && <span className="ml-1 text-xs font-normal text-slate-500">{unidad}</span>}
      </span>
    </div>
  );
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</h3>
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
        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Simulado</span>
        : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">{p.fuente}</span>)
    : null;

  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Estado de planta</h2>
        {insignia}
        {p && detenido && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-800 dark:bg-red-950/40 dark:text-red-300">
            sin señal
          </span>
        )}
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Leyendo estado de planta…</p>
      ) : !p ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-600">
          Sin estado de planta para este ciclo. Lo escribe el PLC o, en la demo, el simulador.
        </p>
      ) : (
        <div className={`grid gap-3 md:grid-cols-2 ${detenido ? "opacity-50" : ""}`}>
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
