"use client";
import Link from "next/link";
import { useCiclosRecientes, useLineas } from "@/hooks/useCiclos";
import { useAlertas } from "@/hooks/useDatosCip";
import PanelAlertas from "@/components/PanelAlertas";
import { Estado, FilaKpi, Kpi, Simulado, Tarjeta, Vacio } from "@/components/ui/Sala";
import { ciclosDelDia, duracionMin, estadoDeCiclo, resumenDe } from "@/lib/central";
import { ETAPA_LABEL } from "@/lib/tipos";

const hora = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate?.().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) ?? "—";

export default function CentralPage() {
  const { ciclos, cargando } = useCiclosRecientes();
  const lineas = useLineas();
  const alertas = useAlertas();
  const hoy = ciclosDelDia(ciclos, new Date());
  const r = resumenDe(hoy);
  const haySimulados = ciclos.some((c) => c.simulado);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <FilaKpi>
          <Kpi etiqueta="Ciclos hoy" valor={r.total} detalle={`${r.enCurso} en curso`} />
          <Kpi etiqueta="Agua limpia" valor={r.limpios} detalle="cumplen el criterio" tono={r.limpios ? "ok" : undefined} />
          <Kpi etiqueta="Sin agua limpia" valor={r.sinLimpiar} detalle="revisar el enjuague" tono={r.sinLimpiar ? "crit" : undefined} />
          <Kpi etiqueta="Agua de red hoy" valor={r.aguaM3.toFixed(2).replace(".", ",")} unidad="m³" />
        </FilaKpi>

        <Tarjeta titulo="Líneas conectadas" derecha={haySimulados ? <Simulado /> : undefined}>
          {lineas.length === 0 ? <Vacio>{cargando ? "Leyendo líneas…" : "Aún no hay líneas registradas."}</Vacio> : (
            <ul className="grid gap-px bg-line sm:grid-cols-2">
              {lineas.map((l) => {
                const enCurso = ciclos.find((c) => c.lineaId === l.id && c.estado === "en_curso");
                const ultimo = ciclos.find((c) => c.lineaId === l.id);
                return (
                  <li key={l.id} className="bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <b className="text-sm font-semibold">{l.nombre}</b>
                        <p className="text-xs text-ink-3">{l.plantaNombre}</p>
                      </div>
                      {enCurso ? <Estado tono="accent" texto="Limpiando" />
                        : ultimo ? <Estado {...estadoDeCiclo(ultimo)} />
                        : <Estado tono="neutro" texto="Sin ciclos" />}
                    </div>
                    {enCurso ? (
                      <Link href="/dashboard" className="mt-3 block text-[13px] text-accent-ink hover:underline">
                        {ETAPA_LABEL[enCurso.etapaActual] ?? enCurso.etapaActual} · ver ciclo en vivo
                      </Link>
                    ) : ultimo && (
                      <p className="mt-3 font-mono text-xs text-ink-3">Último: {ultimo.id}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Alertas activas" derecha={<span className="font-mono">{alertas.length}</span>}>
          <div className="p-4"><PanelAlertas alertas={alertas} /></div>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Limpiezas de hoy" derecha="inicio · min" className="self-start">
        {hoy.length === 0 ? <Vacio>{cargando ? "Leyendo ciclos…" : "Hoy no hay ciclos todavía."}</Vacio> : (
          <ul className="divide-y divide-line">
            {hoy.map((c) => {
              const min = duracionMin(c);
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="truncate text-[13px] font-semibold" title={c.programa}>{c.programa}</b>
                    <Estado {...estadoDeCiclo(c)} />
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-ink-3">
                    {hora(c.inicio)} · {min === null ? "—" : `${min.toFixed(1).replace(".", ",")} min`} · {c.lineaId}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
