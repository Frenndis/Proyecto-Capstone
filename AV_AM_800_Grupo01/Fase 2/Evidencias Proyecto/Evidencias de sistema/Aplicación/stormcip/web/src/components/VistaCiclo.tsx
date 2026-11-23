"use client";
// Ciclo en vivo: fases proporcionales, gráfico con variables y periodo a elección,
// lecturas, proyección con avisos, validación TACT y sinóptico del lazo.
import { Ic } from "@/components/ui/Ic";
import GraficoPeriodo from "@/components/GraficoPeriodo";
import ProyeccionCiclo from "@/components/ProyeccionCiclo";
import { CicloPlanta, PuntoCurva, aviso, faseEn, inicioFase, mmss, nf, tact } from "@/lib/planta";
import { enMinutos, estadosEn, variable } from "@/lib/tendencia";

function Sinoptico({ tanque, destino, sub, p, activo }: { tanque: string; destino: string; sub: string; p: PuntoCurva; activo: boolean }) {
  const clase = `sy-f${activo ? "" : " is-off"}`;
  return (
    <svg viewBox="0 18 430 118" role="img" aria-label={`Lazo de ${tanque} hacia ${destino}`}>
      <rect x="12" y="46" width="62" height="56" className="sy-b" /><text x="43" y="79" className="sy-t" textAnchor="middle">{tanque}</text>
      <path d="M74 74H128M154 74H196M240 74H288" className="sy-p" /><path d="M74 74H128M154 74H196M240 74H288" className={clase} />
      <circle cx="141" cy="74" r="13" className="sy-b" /><text x="141" y="78" className="sy-t" textAnchor="middle">P</text>
      <rect x="196" y="56" width="44" height="36" className="sy-b" /><text x="218" y="78" className="sy-t" textAnchor="middle">HX</text>
      <rect x="288" y="42" width="128" height="64" rx="4" className="sy-b" />
      <text x="352" y="70" className="sy-t" textAnchor="middle">{destino}</text><text x="352" y="88" className="sy-t sy-t--d" textAnchor="middle">{sub}</text>
      <path d="M352 106V126H43V102" className="sy-p" /><path d="M352 106V126H43V102" className={clase} />
      <text x="176" y="30" className="sy-v" textAnchor="middle">{nf(p.q, 1)} m³/h</text>
      <text x="176" y="118" className="sy-v" textAnchor="middle">{nf(p.T, 1)} °C</text>
      <text x="268" y="118" className="sy-v" textAnchor="middle">{nf(p.c, 2)} %</text>
    </svg>
  );
}

/** Lo que el modelo esperaba de este ciclo, contra lo que va ocurriendo. */
function PanelModelo({ ciclo, punto }: { ciclo: CicloPlanta; punto: PuntoCurva }) {
  const p = ciclo.prediccion!;
  const riesgo = Math.round(p.riesgo * 100);
  const i = faseEn(ciclo.fases, punto.t);
  const f = ciclo.fases[i];
  const vivo = ciclo.prediccionVivo?.[f.n];
  const previa = p.limpio[f.n];
  const lim = vivo ?? previa;
  return (
    <section className="card pcard ml-vivo">
      <p className="pcard__t">Predicción del modelo <span className="mono">Random Forest</span></p>
      <div className="evi">
        <div><span>Agua al cierre</span><b className="mono">{nf(p.aguaL)} ± {nf(p.aguaMargen)} L</b></div>
        <div><span>Químico al cierre</span><b className="mono">{nf(p.quimicoL, 1)} ± {nf(p.quimicoMargen, 1)} L</b></div>
        <div><span>Riesgo de desvío</span><b className="mono" style={{ color: riesgo >= 50 ? "var(--crit)" : riesgo >= 25 ? "var(--warn)" : "var(--ok)" }}>{riesgo} %</b></div>
        {f.enjuague && lim && <div><span>{vivo ? "Agua limpia, corregida en vivo" : "Agua limpia"}</span><b className="mono">{mmss(lim.s)} de {mmss(f.s)}</b></div>}
      </div>
    </section>
  );
}

const ICONO_T = { ok: "check", warn: "alert", wait: "clock" } as const;
const ICONO_A = { info: "clock", ok: "check", warn: "alert", crit: "alert" } as const;

export default function VistaCiclo({ ciclo }: { ciclo: CicloPlanta }) {
  const punto = ciclo.curva[ciclo.curva.length - 1];
  const cerrado = ciclo.estado !== "en_curso";
  const dur = ciclo.fases.reduce((a, f) => a + f.s, 0);
  const i = faseEn(ciclo.fases, punto.t);
  const f = ciclo.fases[i];
  const dentro = punto.t - inicioFase(ciclo.fases, i);
  const filas = tact(f, punto, dentro);
  // Una variable que va hacia su límite tiene prioridad sobre el mensaje de la fase
  const tiende = cerrado ? undefined : estadosEn(ciclo, ciclo.curva.length - 1).find((e) => e.estado === "tiende");
  const av = tiende
    ? { tono: "warn" as const, texto: `${variable(tiende.v).corto} tiende a salir de rango: llegaría a ${nf(tiende.limite!, variable(tiende.v).dec)} ${variable(tiende.v).unidad} en ${enMinutos(tiende.enS!)} (confianza ${tiende.confianza} %).` }
    : aviso(f, punto, dentro, cerrado, ciclo);
  const tanque = f.c > 0.9 ? "Soda" : f.c > 0.1 ? (f.n === "Monofase" ? "Mono" : "Ácido") : "Agua";
  const [destino, ...resto] = ciclo.circuito.split(" · ");
  const v = ciclo.resumen?.validacion;
  const chip = !cerrado ? { c: "sc--accent", t: "En vivo" } : ciclo.estado === "abortado" ? { c: "", t: "Abortado" }
    : v === "fuera" ? { c: "sc--crit", t: "Fuera de límite" } : v === "desvio" ? { c: "sc--warn", t: "Con desvío" } : { c: "sc--ok", t: "Validado" };

  return (
    <>
      <header className="lv-h">
        <div>
          <b>{ciclo.circuito}</b>
          <p>Receta «{ciclo.programa}»: {ciclo.lead}</p>
        </div>
        <p className="lv-src">{cerrado ? `Registro ${ciclo.numero}` : `${ciclo.numero} · acelerado ${ciclo.velocidad ?? 20}× para la demo`}<br />Temperatura y conductividad de retorno · caudalímetro</p>
        <div className="lv-clock">
          <span className={`sc ${chip.c}`}><i className={cerrado ? "" : "pulse"} /><span>{chip.t}</span></span>
          <b className="mono">{mmss(punto.t)}</b><span className="mono">de {mmss(dur)}</span>
        </div>
      </header>

      <div className="ph">
        {ciclo.fases.map((fa, k) => {
          const a = inicioFase(ciclo.fases, k);
          const p = Math.max(0, Math.min(1, (punto.t - a) / fa.s));
          return (
            <button key={fa.n} style={{ flex: fa.s }} className={k === i && !cerrado ? "is-on" : ""} tabIndex={-1}>
              <span>{fa.n}{fa.s > fa.sReceta ? ` · +${mmss(fa.s - fa.sReceta)}` : ""}</span>
              <i><b style={{ transform: `scaleX(${p})`, transition: cerrado ? undefined : "transform 1s linear" }} /></i>
            </button>
          );
        })}
      </div>

      <div className="lv-b">
        <section className="card lv-chart">
          <GraficoPeriodo ciclo={ciclo} />
          <div className={`aviso aviso--${av.tono === "crit" ? "warn" : av.tono}`}><Ic n={ICONO_A[av.tono]} /><span>{av.texto}</span></div>
        </section>
        <div className="lv-r">
          <div className="lv-reads">
            {[["Temperatura", nf(punto.T, 1), "°C", filas[0].estado], ["Concentración", nf(punto.c, 2), "%", filas[2].estado], ["Agua", nf(punto.a), "L", "ok"], ["Químico", nf(punto.k, 1), "L", "ok"]].map(([l, val, u, e]) => (
              <div key={l} className="card rd">
                <p className="kpi__l">{l}<i className={`rd__dot${e === "warn" ? " rd__dot--warn" : ""}`} /></p>
                <p className="rd__v mono"><b>{val}</b> {u}</p>
              </div>
            ))}
          </div>
          <ProyeccionCiclo ciclo={ciclo} />
          {ciclo.prediccion && <PanelModelo ciclo={ciclo} punto={punto} />}
          <section className="card pcard tact">
            <p className="pcard__t">Validación TACT</p>
            {filas.map((x) => (
              <div className="tr" key={x.nombre}>
                <span className={`tr__i tr__i--${x.estado}`}><Ic n={ICONO_T[x.estado]} /></span>
                <b>{x.nombre}</b><span className="mono">{x.valor}</span>
              </div>
            ))}
          </section>
          <section className="card lv-syn">
            <Sinoptico tanque={tanque} destino={destino} sub={resto.join(" · ") || ciclo.area} p={punto} activo={!cerrado && punto.q > 1} />
          </section>
        </div>
      </div>
    </>
  );
}
