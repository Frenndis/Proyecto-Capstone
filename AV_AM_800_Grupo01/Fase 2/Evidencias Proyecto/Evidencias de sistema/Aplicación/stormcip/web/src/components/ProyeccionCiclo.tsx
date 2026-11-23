"use client";
// Proyección del ciclo en minutos, con su nivel de confianza, y la bitácora de avisos:
// cuándo una variable empezó a ir hacia su límite, cuándo salió y cuándo volvió.
import { useMemo } from "react";
import { Ic } from "@/components/ui/Ic";
import { useConfigCalculos } from "@/hooks/useCiclos";
import { CicloPlanta, mmss } from "@/lib/planta";
import { CRITERIO_DEFECTO, avisosCiclo, enMinutos, nivelConfianza, proyectar } from "@/lib/tendencia";

function Confianza({ pct }: { pct: number }) {
  return (
    <span className="conf" title="Qué tan firme es la proyección con las lecturas disponibles">
      <i><b style={{ width: `${pct}%` }} /></i>
      <span>confianza <b className="mono">{pct} %</b> · {nivelConfianza(pct)}</span>
    </span>
  );
}

const ICONO = { warn: "alert", crit: "alert", ok: "check" } as const;

export default function ProyeccionCiclo({ ciclo }: { ciclo: CicloPlanta }) {
  const cfg = useConfigCalculos();
  const criterio = useMemo(() => ({
    ecRed: cfg?.conductividadAguaRed ?? CRITERIO_DEFECTO.ecRed,
    ecLimpio: cfg?.criterioLimpio?.conductividad25C ?? CRITERIO_DEFECTO.ecLimpio,
  }), [cfg?.conductividadAguaRed, cfg?.criterioLimpio?.conductividad25C]);
  const enCurso = ciclo.estado === "en_curso";
  const n = ciclo.curva.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p = useMemo(() => proyectar(ciclo, n - 1, criterio), [ciclo.id, n, criterio]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const avisos = useMemo(() => avisosCiclo(ciclo, criterio), [ciclo.id, n, criterio]);
  const l = p?.limpio;
  const previsto = ciclo.prediccionVivo?.[p?.fase ?? ""] ?? ciclo.prediccion?.limpio[p?.fase ?? ""];

  return (
    <section className="card pry" aria-live="polite">
      <p className="pcard__t">Proyección {enCurso && <span className="mono">se actualiza con cada lectura</span>}</p>
      {enCurso && p ? (
        <div className="pry__g">
          <div className="pry__c">
            <span>Fin del ciclo</span>
            <b>{enMinutos(p.finCiclo.restanteS)}</b>
            <Confianza pct={p.finCiclo.confianza} />
            <p className="pry__d">Lo que falta de la receta. La confianza descuenta el riesgo de que una fase se extienda por temperatura.</p>
          </div>
          <div className="pry__c">
            <span>Agua limpia{l ? ` · ${p.fase.toLowerCase()}` : ""}</span>
            {!l ? (
              <>
                <b style={{ color: "var(--ink-3)" }}>—</b>
                <p className="pry__d">Se proyecta durante los enjuagues, con la caída de la conductividad de retorno.</p>
              </>
            ) : l.estado === "limpio" ? (
              <>
                <b className="is-ok">Cumplido</b>
                <p className="pry__d">Llegó a ≤ {criterio.ecLimpio} µS/cm a los {mmss(l.alS)} de la fase.</p>
              </>
            ) : l.estado === "reuniendo" ? (
              <>
                <b style={{ color: "var(--ink-3)" }}>Midiendo…</b>
                <p className="pry__d">Hacen falta al menos 4 lecturas de la caída para proyectar.</p>
              </>
            ) : (
              <>
                <b className={l.alcanza ? "" : "is-warn"}>{enMinutos(l.restanteS)}</b>
                <Confianza pct={l.confianza} />
                <p className="pry__d">
                  {l.alcanza ? `Quedarían ${mmss(Math.max(0, l.sobraS))} de fase con el agua ya limpia.` : `No alcanzaría dentro de la fase: faltarían ${mmss(-l.sobraS)}.`}
                  {previsto ? ` El modelo esperaba ${mmss(previsto.s)} ± ${mmss(previsto.margen)}.` : ""}
                </p>
              </>
            )}
          </div>
        </div>
      ) : <p className="pry__d">Ciclo cerrado: la proyección corre mientras hay un ciclo en curso. Abajo queda lo que se avisó durante el ciclo.</p>}

      <p className="pcard__t">Avisos del ciclo <span className="mono">{avisos.length}</span></p>
      {avisos.length === 0 ? <p className="pry__d">Sin avisos: ninguna variable salió de su rango ni tendió a salir.</p> : (
        <div className="avs">
          {[...avisos].reverse().map((a) => (
            <div key={`${a.t}${a.v}${a.tono}`} className={`av av--${a.tono}`}>
              <Ic n={ICONO[a.tono]} /><span className="mono">{mmss(a.t)}</span><span>{a.texto}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
