"use client";
// Ciclo en vivo, como la maqueta Storm CIP: fases proporcionales, curvas por carril,
// lecturas, validación TACT y sinóptico del lazo. Lee la curva que escribe el backend.
import { useEffect, useMemo, useRef } from "react";
import { Ic } from "@/components/ui/Ic";
import { gsap, sinMovimiento } from "@/lib/animacion";
import { CicloPlanta, PuntoCurva, aviso, faseEn, inicioFase, mmss, nf, tact } from "@/lib/planta";

const X0 = 46, X1 = 712;
const CARRILES = { T: [14, 268, 0, 90], c: [304, 410, 0, 1.6], q: [440, 526, 0, 32] } as const;
type Carril = keyof typeof CARRILES;
const yDe = (k: Carril, v: number) => {
  const [a, b, min, max] = CARRILES[k];
  return b - ((Math.min(v, max) - min) / (max - min)) * (b - a);
};
const GRILLA: [number, Carril][] = [[0, "T"], [30, "T"], [60, "T"], [90, "T"], [0, "c"], [0.8, "c"], [1.6, "c"], [0, "q"], [16, "q"], [32, "q"]];
const ETIQUETAS: [string, Carril][] = [["Temperatura de retorno, °C", "T"], ["Concentración, %", "c"], ["Caudal, m³/h", "q"]];
const LINEA: Record<Carril, string> = { T: "lv-l1", c: "lv-l2", q: "lv-l3" };

function Curvas({ ciclo, punto }: { ciclo: CicloPlanta; punto: PuntoCurva }) {
  const dur = ciclo.fases.reduce((a, f) => a + f.s, 0);
  const xDe = (t: number) => X0 + (t / dur) * (X1 - X0);
  const lineas = useRef<Partial<Record<Carril, SVGPolylineElement | null>>>({});
  const cabezas = useRef<Partial<Record<Carril, SVGCircleElement | null>>>({});
  const previo = useRef<PuntoCurva | null>(null);
  const puntos = useMemo(() => {
    const armar = (k: Carril) => ciclo.curva.slice(0, -1).map((p) => `${xDe(p.t).toFixed(1)},${yDe(k, p[k]).toFixed(1)}`).join(" ");
    return { T: armar("T"), c: armar("c"), q: armar("q") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciclo.curva.length, ciclo.id]);

  // La punta avanza suave entre lecturas y arrastra el final de cada línea
  useEffect(() => {
    const dibujar = (o: { t: number; T: number; c: number; q: number }) => {
      (["T", "c", "q"] as Carril[]).forEach((k) => {
        const x = xDe(o.t), y = yDe(k, o[k]);
        lineas.current[k]?.setAttribute("points", `${puntos[k]} ${x.toFixed(1)},${y.toFixed(1)}`);
        cabezas.current[k]?.setAttribute("cx", String(x));
        cabezas.current[k]?.setAttribute("cy", String(y));
      });
    };
    const de = previo.current && previo.current.t <= punto.t ? previo.current : punto;
    previo.current = punto;
    if (sinMovimiento() || de === punto || ciclo.estado !== "en_curso") { dibujar(punto); return; }
    const o = { t: de.t, T: de.T, c: de.c, q: de.q };
    const tw = gsap.to(o, { t: punto.t, T: punto.T, c: punto.c, q: punto.q, duration: 1, ease: "none", onUpdate: () => dibujar(o) });
    return () => { tw.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punto, puntos]);

  // Un ciclo terminado se traza al abrirlo
  const trazado = useRef("");
  useEffect(() => {
    if (ciclo.estado === "en_curso" || trazado.current === ciclo.id || sinMovimiento()) return;
    trazado.current = ciclo.id;
    gsap.fromTo(Object.values(lineas.current), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.4, ease: "power2.inOut", stagger: 0.12 });
  }, [ciclo.id, ciclo.estado]);

  return (
    <svg viewBox="0 0 720 540" role="img" aria-label="Temperatura, concentración y caudal del ciclo">
      {ciclo.fases.map((f, i) => {
        const a = xDe(inicioFase(ciclo.fases, i)), b = xDe(inicioFase(ciclo.fases, i + 1));
        return (
          <g key={f.n}>
            {i > 0 && <line x1={a} x2={a} y1={14} y2={526} className="lv-div" />}
            {f.min !== null && <rect x={a} width={b - a} y={yDe("T", f.min + 10)} height={yDe("T", f.min) - yDe("T", f.min + 10)} className="lv-band" />}
          </g>
        );
      })}
      {GRILLA.map(([v, k]) => (
        <g key={`${k}${v}`}>
          <line x1={X0} x2={X1} y1={yDe(k, v)} y2={yDe(k, v)} className="lv-grid" />
          <text x={X0 - 8} y={yDe(k, v) + 4} className="lv-tick" textAnchor="end">{String(v).replace(".", ",")}</text>
        </g>
      ))}
      {ETIQUETAS.map(([t, k]) => <text key={k} x={X0 + 6} y={CARRILES[k][0] + 4} className="lv-lane">{t}</text>)}
      {(["q", "c", "T"] as Carril[]).map((k) => (
        <g key={k}>
          <polyline ref={(e) => { lineas.current[k] = e; }} className={LINEA[k]} fill="none" />
          <circle ref={(e) => { cabezas.current[k] = e; }} r={k === "T" ? 4.5 : 3.2} className={`${LINEA[k]}d`} />
        </g>
      ))}
    </svg>
  );
}

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
  const av = aviso(f, punto, dentro, cerrado, ciclo);
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
          <Curvas ciclo={ciclo} punto={punto} />
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
