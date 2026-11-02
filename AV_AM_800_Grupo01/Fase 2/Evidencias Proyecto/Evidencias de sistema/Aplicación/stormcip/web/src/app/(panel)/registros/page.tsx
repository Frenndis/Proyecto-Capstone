"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCiclosPlanta } from "@/hooks/usePlanta";
import { gsap, useEntrada } from "@/lib/animacion";
import { Ic } from "@/components/ui/Ic";
import { CicloPlanta, estadoCiclo, fechaCorta, fechaDe, inicioFase, mmss, nf } from "@/lib/planta";

const ESTADO_FASE = { cumple: "Cumple", corregido: "Corregido", fuera: "Fuera de límite" };
const SELLO = { validado: ["", "Validado"], desvio: ["ds-stamp--w", "Con desvío"], fuera: ["ds-stamp--c", "Fuera de límite"] } as const;

function Hoja({ c }: { c: CicloPlanta }) {
  const r = c.resumen!;
  const dur = c.fases.reduce((a, f) => a + f.s, 0);
  const xx = (t: number) => 4 + (t / dur) * 712;
  const yy = (v: number) => 112 - (v / 90) * 104;
  const pts = c.curva.map((p) => `${xx(p.t).toFixed(1)},${yy(p.T).toFixed(1)}`).join(" ");
  const ref = useEntrada<HTMLElement>((el) => {
    gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" });
    gsap.fromTo(el.querySelector(".ds-line"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.4, ease: "power2.inOut", delay: 0.3 });
    gsap.fromTo(el.querySelectorAll("tbody tr"), { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.09, delay: 0.8 });
    gsap.fromTo(el.querySelector(".ds-stamp"), { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power3.out", delay: 1.6 });
  }, [c.id]);
  const [clase, texto] = SELLO[r.validacion];

  return (
    <article className="doc-sheet" ref={ref}>
      <header className="ds-h">
        <div><p className="ds-eyebrow">Registro de limpieza CIP</p><h2>{c.circuito}</h2></div>
        <div className="ds-id"><b className="mono">{c.numero}</b><span className={`ds-stamp ${clase}`}>{texto}</span></div>
      </header>
      <dl className="ds-spec">
        <div><dt>Fecha</dt><dd className="mono">{fechaCorta(fechaDe(c.inicio))}</dd></div>
        <div><dt>Receta</dt><dd>{c.programa}, {c.recetaVersion}</dd></div>
        <div><dt>Duración</dt><dd className="mono">{mmss(r.duracionS)} min</dd></div>
        <div><dt>Operador</dt><dd>{c.operador}</dd></div>
      </dl>
      <svg className="ds-curve" viewBox="0 0 720 120" preserveAspectRatio="none" role="img" aria-label="Curva de temperatura de retorno del ciclo">
        {c.fases.map((f, i) => {
          const a = xx(inicioFase(c.fases, i)), b = xx(inicioFase(c.fases, i + 1));
          return (
            <g key={f.n}>
              {f.min !== null && <rect x={a} width={b - a} y={yy(f.min + 10)} height={yy(f.min) - yy(f.min + 10)} className="ds-band" />}
              {i > 0 && <line x1={a} x2={a} y1={6} y2={114} className="ds-div" />}
            </g>
          );
        })}
        <polyline points={pts} className="ds-line" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <table className="ds-t">
        <thead><tr><th>Fase</th><th>Objetivo</th><th>Temp. mínima</th><th>Conc. media</th><th>Agua limpia</th><th>Duración</th><th>Estado</th></tr></thead>
        <tbody>
          {r.fases.map((f) => (
            <tr key={f.n}>
              <td>{f.n}{f.estado === "corregido" && <small>extendida 2:00</small>}</td>
              <td className="mono">{f.objetivoT} °C{f.objetivoC > 0.1 ? ` · ${nf(f.objetivoC, 1)} %` : ""}</td>
              <td className="mono">{f.tMin !== null ? `${nf(f.tMin, 1)} °C` : "—"}</td>
              <td className="mono">{f.concMedia !== null ? `${nf(f.concMedia, 2)} %` : "—"}</td>
              <td className="mono">{f.limpioS !== null ? mmss(f.limpioS) : "—"}</td>
              <td className="mono">{mmss(f.durS)}</td>
              <td className={`ds-st${f.estado === "corregido" ? " ds-st--w" : f.estado === "fuera" ? " ds-st--c" : ""}`}>{ESTADO_FASE[f.estado]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ds-foot">Generado por Storm CIP desde la lectura del proceso. Sin digitación. Trazable en cada punto de la curva.</p>
    </article>
  );
}

function Liberacion({ c }: { c: CicloPlanta }) {
  const r = c.resumen!;
  const enjuague = r.fases.filter((f) => /Enjuague final|Enjuague$/.test(f.n)).pop();
  const fuera = r.validacion === "fuera";
  const [hechos, setHechos] = useState(0);
  useEffect(() => {
    setHechos(0);
    const ts = [900, 1700, 2500].map((ms, i) => setTimeout(() => setHechos(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [c.id]);
  const pasos = [
    { t: "Telemetría CIP", p: fuera ? "Una fase quedó fuera de su límite" : r.validacion === "desvio" ? "TACT cumplido, con desvío corregido" : "TACT cumplido en todas las fases", ok: !fuera },
    { t: "Agua limpia verificada", p: enjuague?.limpioS != null ? `Conductividad ≤ 200 µS/cm a los ${mmss(enjuague.limpioS)} de ${mmss(enjuague.durS)}` : "No alcanzó el criterio", ok: enjuague?.limpioS != null },
    { t: fuera ? "Circuito retenido" : "Circuito liberado", p: fuera ? "Repetir la limpieza antes de usar" : `${fechaCorta(fechaDe(c.fin))} · listo para el próximo uso`, ok: !fuera },
  ];
  return (
    <section className="card pcard">
      <p className="pcard__t">Liberación del circuito</p>
      <ol className="rel">
        {pasos.map((x, i) => (
          <li key={x.t} className={i < hechos && x.ok ? "is-done" : ""} style={i < hechos && !x.ok ? { opacity: 1, color: "var(--crit)" } : undefined}>
            <i /><div><b>{x.t}</b><p className={i === 2 ? "mono" : ""}>{x.p}</p></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Registros() {
  const { ciclos, cargando } = useCiclosPlanta();
  const pedido = useSearchParams().get("id");
  const lista = ciclos.filter((c) => c.estado === "finalizado" && c.resumen);
  const [elegido, setElegido] = useState<string | null>(pedido);
  useEffect(() => { if (pedido) setElegido(pedido); }, [pedido]);
  const c = lista.find((x) => x.id === elegido) ?? lista[0];

  return (
    <section className="v v-reg">
      <div className="card reg-lista">
        <p className="pcard__t" style={{ padding: "14px 14px 0" }}>Registros <span className="mono">{lista.length}</span></p>
        <div className="reg-lista__scroll">
          {cargando && <p className="pcard__p" style={{ padding: 14 }}>Leyendo registros…</p>}
          {lista.slice(0, 120).map((x) => {
            const e = estadoCiclo(x);
            return (
              <button key={x.id} className={`reg-fila${x.id === c?.id ? " is-on" : ""}`} onClick={() => setElegido(x.id)}>
                <span className="reg-fila__t"><b>{x.circuito}</b></span>
                <span className="reg-fila__t"><span className="mono">{x.numero} · {fechaDe(x.inicio)?.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}</span><span className={`st st--${e.tono === "idle" ? "none" : e.tono}`} style={{ fontSize: 11 }}><i />{e.texto}</span></span>
              </button>
            );
          })}
        </div>
      </div>
      {c ? <Hoja c={c} /> : <p className="card pcard pcard__p">{cargando ? "" : "Aún no hay registros."}</p>}
      {c && (
        <aside className="reg-side">
          <Liberacion c={c} />
          <section className="card pcard">
            <p className="pcard__t">Consumo de este ciclo</p>
            <div className="evi">
              <div><span><Ic n="drop" />Agua</span><b className="mono">{nf(c.resumen!.aguaL)} L</b></div>
              <div><span><Ic n="drop" />Químico</span><b className="mono">{nf(c.resumen!.quimicoL, 1)} L</b></div>
              <div><span><Ic n="clock" />Duración</span><b className="mono">{mmss(c.resumen!.duracionS)}</b></div>
            </div>
          </section>
          <button className="btn2" onClick={() => window.print()}><Ic n="download" />Imprimir registro</button>
        </aside>
      )}
    </section>
  );
}

export default function RegistrosPage() {
  return <Suspense><Registros /></Suspense>;
}
