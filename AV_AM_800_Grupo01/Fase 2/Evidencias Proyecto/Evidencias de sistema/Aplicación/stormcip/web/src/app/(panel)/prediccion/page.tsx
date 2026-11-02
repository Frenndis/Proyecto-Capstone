"use client";
// Predicción como decisiones: qué cambiar, cuánto ahorra, por qué, y el botón para resolverlo.
import { useState } from "react";
import { registrarDecision, useEstadosDecision, useOportunidades } from "@/hooks/usePlanta";
import { useAuth } from "@/lib/auth-context";
import { Ic } from "@/components/ui/Ic";
import { useConteo, gsap, useEntrada } from "@/lib/animacion";
import { Decision, EstadoDecision, MetricaModelo, Prediccion, mmss, nf } from "@/lib/planta";

/** Dibuja el tiempo actual, cuándo ya estaba limpio y el tiempo propuesto. */
function BarraTiempo({ d }: { d: Decision }) {
  const total = d.configuradoS!;
  const pos = (s: number) => `${(s / total) * 100}%`;
  return (
    <div className="tb2" role="img" aria-label={`Hoy ${mmss(total)}. Agua limpia en ${mmss(d.p95S!)}. Propuesta ${mmss(d.sugeridoS!)}.`}>
      <div className="tb2__pista">
        <div className="tb2__util" style={{ width: pos(d.sugeridoS!) }} />
        <div className="tb2__ahorro" style={{ left: pos(d.sugeridoS!), right: 0 }} />
      </div>
      <div className="tb2__m" style={{ left: pos(d.p95S!), background: "#37C08B" }} />
      <span className="tb2__l" style={{ left: pos(d.p95S!), transform: "translateX(-100%)", color: "#37C08B", paddingRight: 4 }}>limpio {mmss(d.p95S!)}</span>
      <span className="tb2__l tb2__l--b" style={{ left: pos(d.sugeridoS!), transform: "none", paddingLeft: 4 }}>propuesta {mmss(d.sugeridoS!)}</span>
      <span className="tb2__l tb2__l--e" style={{ left: "100%" }}>hoy {mmss(total)}</span>
    </div>
  );
}

const ETIQUETA_IMPACTO = {
  acortar_enjuague: "de agua al mes", ajustar_dosis: "de químico al mes", posible_fuga: "de agua al mes", revisar_circuito: "por desvíos al mes",
};

function Tarjeta({ d, estado, puedeDecidir }: { d: Decision; estado?: EstadoDecision; puedeDecidir: boolean }) {
  const alerta = d.tipo === "revisar_circuito" || d.tipo === "posible_fuga";
  const aprobada = estado?.estado === "aprobada", descartada = estado?.estado === "descartada";
  const impacto = d.tipo === "ajustar_dosis" ? `${nf(d.quimicoMesL)} L`
    : d.tipo === "revisar_circuito" ? `${nf(d.minutosMes)} min` : `${nf(d.aguaMesL / 1000, 1)} m³`;
  const verbo = alerta ? "Asignar a mantención" : "Aprobar primer paso";
  return (
    <article className={`card dc${alerta ? " dc--alerta" : ""}${aprobada ? " dc--ok" : ""}${descartada ? " dc--desc" : ""}`}>
      <div className="dc__top">
        <div>
          <h3 className="dc__t">{d.titulo}</h3>
          <div className="dc__cambio" style={{ marginTop: 6 }}><s>{d.hoy}</s><Ic n="arrow" /><b>{d.propuesta}</b></div>
        </div>
        <div className="dc__impacto"><b>{impacto}</b><span>{ETIQUETA_IMPACTO[d.tipo]}</span></div>
      </div>
      {d.configuradoS !== undefined && <BarraTiempo d={d} />}
      <p className="dc__p">{d.porque} {d.aplicar}</p>
      <div className="dc__a">
        {aprobada ? <span className="sc sc--ok"><i /><span>Aprobada{estado?.por ? ` por ${estado.por}` : ""}</span></span>
          : descartada ? <span className="sc"><i /><span>Descartada</span></span>
          : puedeDecidir && (
            <>
              <button className="btn2 btn2--pri" onClick={() => registrarDecision(d.id, "aprobada")}><Ic n="check" />{verbo}</button>
              <button className="btn2" onClick={() => registrarDecision(d.id, "descartada")}>Descartar</button>
            </>
          )}
        {(aprobada || descartada) && puedeDecidir && <button className="btn2" onClick={() => registrarDecision(d.id, null)}>Deshacer</button>}
        <span className="dc__nota">{d.ciclos} ciclos · confianza {d.confianza}</span>
      </div>
    </article>
  );
}

function Numero({ v, dec = 0, suf, texto }: { v: number; dec?: number; suf: string; texto: string }) {
  const ref = useConteo(v, (n) => nf(n, dec));
  return <div className="pr-num"><b><span ref={ref}>0</span><small>{suf}</small></b><p>{texto}</p></div>;
}

function FilaPrediccion({ p }: { p: Prediccion }) {
  const m = p.ml;
  const agua = m?.aguaL ?? p.aguaL, margen = m?.aguaMargen ?? p.aguaError;
  const riesgo = m ? Math.round(m.riesgo * 100) : null;
  const final = m?.limpio["Enjuague final"] ?? m?.limpio["Enjuague"];
  return (
    <div className="pp">
      <b title={p.circuito}>{p.circuito}</b><span>{nf(agua)} L</span>
      <small>≈ {nf(m?.quimicoL ?? p.quimicoL, 1)} L químico{final ? ` · limpio ${mmss(final.s)}` : ""}</small><small>± {nf(margen)} L</small>
      {riesgo !== null && (
        <span className="pp__r" style={{ gridColumn: "1 / -1" }}>
          <i><b style={{ width: `${riesgo}%`, background: riesgo >= 50 ? "var(--crit)" : riesgo >= 25 ? "var(--warn)" : "var(--ok)" }} /></i>
          <small>riesgo de desvío {riesgo} %</small>
        </span>
      )}
    </div>
  );
}

const fmtErr = (m: MetricaModelo, v: number) => (m.id === "riesgo" ? nf(v, 1) : m.unidad === "s" ? `${nf(v)} s` : `${nf(v, m.id === "quimico" ? 1 : 0)} ${m.unidad}`);

/** Qué tan bien predice cada modelo, medido en ciclos que no vio al entrenar. */
function Modelos({ ml }: { ml: NonNullable<import("@/lib/planta").Oportunidades["ml"]> }) {
  const principal = ml.metricas.find((m) => m.id === "limpio");
  return (
    <section className="card pcard ml-card">
      <div className="ml-card__h">
        <div>
          <p className="pcard__t" style={{ marginBottom: 4 }}>Modelos de machine learning</p>
          <p className="pcard__p">{ml.algoritmo} de {ml.arboles} árboles, entrenados con {nf(ml.ciclos)} ciclos <b>simulados</b>. Se reentrenan al cerrar cada ciclo y se miden con el 20 % más reciente, que no vieron.</p>
        </div>
      </div>
      <div className="ml-tabla">
        <table className="ds-t ml-t">
          <thead><tr><th>Qué predice</th><th>Error del modelo</th><th>Error del promedio</th><th>Mejora</th><th>Estado</th></tr></thead>
          <tbody>
            {ml.metricas.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}</td>
                <td className="mono">{fmtErr(m, m.error)}</td>
                <td className="mono">{fmtErr(m, m.errorBase)}</td>
                <td className="mono">{m.mejora >= 0 ? "+" : ""}{nf(m.mejora * 100)} %</td>
                <td><span className={`st st--${m.util ? "ok" : "warn"}`}><i />{m.util ? "En uso" : "No supera la base"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {principal && (
          <div className="ml-fact">
            <p className="kpi__l" style={{ marginBottom: 8 }}>Lo que más alarga un enjuague</p>
            {principal.factores.map((f) => (
              <div className="ml-f" key={f.n}><span>{f.n}</span><i><b style={{ width: `${f.peso * 100}%` }} /></i><em className="mono">{nf(f.peso * 100)} %</em></div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function PrediccionPage() {
  const { oportunidades: o, cargando } = useOportunidades();
  const estados = useEstadosDecision();
  const { rol } = useAuth();
  const [todas, setTodas] = useState(false);
  const raiz = useEntrada<HTMLElement>((el) => {
    gsap.fromTo(el.querySelectorAll(".dc"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: "power3.out", delay: 0.2 });
  }, [cargando]);

  if (!o) return <section className="v"><p className="card pcard pcard__p">{cargando ? "Calculando decisiones…" : "Las decisiones aparecen cuando la planta tenga ciclos cerrados."}</p></section>;

  const atender = o.decisiones.filter((d) => d.tipo === "posible_fuga" || d.tipo === "revisar_circuito");
  const ahorros = o.decisiones.filter((d) => !atender.includes(d));
  const pendientes = ahorros.filter((d) => !estados[d.id] || estados[d.id].estado === "pendiente" as never);
  const aprobadas = o.decisiones.filter((d) => estados[d.id]?.estado === "aprobada");
  const aguaAprobada = aprobadas.reduce((s, d) => s + d.aguaMesL, 0);
  const t = o.totales;
  const pct = (t.aguaMesL / Math.max(t.aguaActualMesL, 1)) * 100;
  const puede = rol === "admin";
  const visibles = todas ? ahorros : ahorros.slice(0, 6);

  return (
    <section className="v v-pred" ref={raiz}>
      <div className="card pr-hero">
        <div>
          <p className="pr-hero__t">Si apruebas todo, la planta deja de gastar <b>{nf(t.aguaMesL / 1000, 1)} m³ de agua al mes</b>, sin bajar la limpieza.</p>
          <p className="pr-hero__s">Es {nf(pct)} % del agua de CIP. Tienes {pendientes.length} cambios por decidir{aprobadas.length ? ` y ${aprobadas.length} ya ${aprobadas.length === 1 ? "aprobado" : "aprobados"} (${nf(aguaAprobada / 1000, 1)} m³/mes)` : ""}.</p>
        </div>
        <Numero v={t.aguaMesL / 1000} dec={1} suf=" m³/mes" texto="agua que se puede ahorrar" />
        <Numero v={t.quimicoMesL} suf=" L/mes" texto="químico que se puede ahorrar" />
        <Numero v={t.minutosMes / 60} dec={1} suf=" h/mes" texto="de planta disponible" />
      </div>

      {o.ml && <Modelos ml={o.ml} />}

      <div className="pr-lista">
        {atender.length > 0 && <p className="pr-grupo">Atender primero · {atender.length}</p>}
        {atender.map((d) => <Tarjeta key={d.id} d={d} estado={estados[d.id]} puedeDecidir={puede} />)}
        <p className="pr-grupo">Para ahorrar · de mayor a menor impacto</p>
        {visibles.map((d) => <Tarjeta key={d.id} d={d} estado={estados[d.id]} puedeDecidir={puede} />)}
        {ahorros.length > 6 && <button className="btn2" onClick={() => setTodas(!todas)}>{todas ? "Ver menos" : `Ver las ${ahorros.length} recomendaciones`}</button>}
      </div>

      <aside className="pr-side">
        <section className="card pcard">
          <p className="pcard__t">Modelo: próximo ciclo <span className="mono">agua</span></p>
          {o.predicciones.map((p) => <FilaPrediccion key={p.circuitoId} p={p} />)}
          <p className="pcard__p" style={{ marginTop: 10, color: "var(--ink-3)", fontSize: 11.5 }}>Predicción del modelo para el próximo ciclo de cada circuito. «±» cubre cerca de 9 de cada 10 ciclos que no vio.</p>
        </section>
        <section className="card pcard">
          <p className="pcard__t">Cómo se decide</p>
          <ol className="rel">
            {[["Aprende de cada ciclo", "Carga, horas sin limpiar, agua y vapor, contra cuándo llegó a agua limpia."],
              ["Predice con margen", "Nunca sugiere menos que el 95 % de lo medido."],
              ["Baja por pasos", "Máximo 10 % por cambio, verificando la limpieza antes de seguir."],
              ["Calidad aprueba", "Storm CIP registra la decisión. No cambia la receta ni el PLC."]].map(([a, b]) => (
                <li className="is-done" key={a}><i /><div><b>{a}</b><p>{b}</p></div></li>
            ))}
          </ol>
        </section>
      </aside>
    </section>
  );
}
