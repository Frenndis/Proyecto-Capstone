"use client";
// Calidad de los modelos de machine learning: todas las métricas medidas en ciclos
// que el modelo no vio, la matriz de confusión del riesgo, real contra predicho y la
// comparación con un modelo lineal entrenado con las mismas filas.
import { useState } from "react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ClasificacionModelo, MetricaModelo, Oportunidades, nf } from "@/lib/planta";

type ML = NonNullable<Oportunidades["ml"]>;

const EJE = { fontSize: 10.5, fill: "#8CA1B8", fontFamily: "IBM Plex Mono, monospace" };
const NADA = "—";

const decimales = (m: MetricaModelo) => (m.id === "riesgo" || m.unidad === "s" ? 1 : m.id === "quimico" ? 2 : 0);
/** Un error en su unidad (el del riesgo es Brier × 100, sin unidad). */
const valor = (m: MetricaModelo, v?: number | null) => (v === undefined || v === null ? NADA : m.id === "riesgo" ? nf(v, 1) : `${nf(v, decimales(m))} ${m.unidad}`);
const pct = (v?: number | null, d = 0) => (v === undefined || v === null ? NADA : `${nf(v * 100, d)} %`);
const num = (v?: number | null, d = 3) => (v === undefined || v === null ? NADA : nf(v, d));
const signo = (v: number) => `${v >= 0 ? "+" : ""}${nf(v * 100)} %`;

const AYUDA = {
  mae: "MAE, error absoluto medio: en promedio, cuánto se equivoca la predicción, en la unidad de la variable. Menor es mejor.",
  rmse: "RMSE, raíz del error cuadrático medio: como el MAE, pero castiga más los errores grandes. Si es mucho mayor que el MAE, hay errores grandes aislados.",
  r2: "R², coeficiente de determinación: qué parte de la variación real explica el modelo. 1 es perfecto; 0 es lo mismo que predecir el promedio general.",
  entrenamiento: "MAE medido en los mismos datos con que se entrenó. Si es mucho menor que el de prueba, el modelo memoriza en vez de generalizar (sobreajuste).",
  base: "MAE de predecir siempre el promedio histórico del mismo circuito (y fase). Es la vara mínima que el modelo debe superar.",
  mejora: "Cuánto reduce el modelo el error de la base: 1 − error del modelo / error de la base.",
  margen: "Percentil 90 del error absoluto: el «±» que acompaña cada predicción.",
  cobertura: "Fracción de ciclos de prueba cuyo valor real cayó dentro del margen ±. Lo esperado es cerca de 90 %.",
  n: "Filas para entrenar / filas de prueba. La prueba es siempre el tramo más reciente, que el modelo no vio.",
  acierto: "Accuracy: fracción de ciclos de prueba bien clasificados (desvío o sin desvío).",
  precision: "Precisión: de los ciclos que el modelo marcó como desvío, cuántos lo fueron de verdad.",
  recall: "Recall o sensibilidad: de los desvíos reales, cuántos detectó el modelo. Es la métrica clave si perder un desvío es caro.",
  f1: "F1: promedio armónico entre precisión y recall. Resume ambas en un número.",
  auc: "AUC (área bajo la curva ROC): probabilidad de que un ciclo con desvío reciba más riesgo que uno sano. 0,5 es azar, 1 es perfecto. No depende del umbral.",
  brier: "Brier × 100: error cuadrático de la probabilidad predicha. Menor es mejor. La base dice siempre la tasa histórica de desvíos.",
};

function Th({ children, ayuda }: { children: React.ReactNode; ayuda?: string }) {
  return <th title={ayuda} className={ayuda ? "ml-ayuda" : undefined}>{children}</th>;
}

function Estado({ m }: { m: MetricaModelo }) {
  return <span className={`st st--${m.util ? "ok" : "warn"}`}><i />{m.util ? "En uso" : "No supera la base"}</span>;
}

/** Tabla de los regresores: todas sus métricas en la prueba. */
function TablaRegresion({ metricas }: { metricas: MetricaModelo[] }) {
  return (
    <div className="ml-scroll">
      <table className="ds-t ml-t">
        <thead>
          <tr>
            <th>Qué predice</th><Th ayuda={AYUDA.mae}>MAE</Th><Th ayuda={AYUDA.rmse}>RMSE</Th><Th ayuda={AYUDA.r2}>R²</Th>
            <Th ayuda={AYUDA.entrenamiento}>MAE entren.</Th><Th ayuda={AYUDA.base}>MAE promedio</Th><Th ayuda={AYUDA.mejora}>Mejora</Th>
            <Th ayuda={AYUDA.margen}>Margen ±</Th><Th ayuda={AYUDA.cobertura}>Cobertura</Th><Th ayuda={AYUDA.n}>Entren. / prueba</Th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {metricas.map((m) => (
            <tr key={m.id}>
              <td>{m.nombre}</td>
              <td className="mono">{valor(m, m.error)}</td>
              <td className="mono">{valor(m, m.rmse)}</td>
              <td className="mono">{num(m.r2)}</td>
              <td className="mono">{valor(m, m.errorEntrenamiento)}</td>
              <td className="mono">{valor(m, m.errorBase)}</td>
              <td className="mono">{signo(m.mejora)}</td>
              <td className="mono">± {valor(m, m.margen)}</td>
              <td className="mono">{pct(m.cobertura)}</td>
              <td className="mono">{nf(m.filas - m.filasPrueba)} / {nf(m.filasPrueba)}</td>
              <td><Estado m={m} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Matriz({ c }: { c: ClasificacionModelo }) {
  const celda = (n: number, nombre: string, bien: boolean) => (
    <div className={`ml-cm__c ${bien ? "ml-cm__c--ok" : "ml-cm__c--mal"}`}><b className="mono">{nf(n)}</b><span>{nombre}</span></div>
  );
  return (
    <div className="ml-cm" role="table" aria-label="Matriz de confusión del riesgo de desvío">
      <span /><span className="ml-cm__h">Predice desvío</span><span className="ml-cm__h">Predice sin desvío</span>
      <span className="ml-cm__h ml-cm__h--f">Desvío real</span>
      {celda(c.vp, "Verdaderos positivos", true)}{celda(c.fn, "Falsos negativos · desvíos perdidos", false)}
      <span className="ml-cm__h ml-cm__h--f">Sin desvío real</span>
      {celda(c.fp, "Falsos positivos · falsas alarmas", false)}{celda(c.vn, "Verdaderos negativos", true)}
    </div>
  );
}

function Clasificador({ m }: { m: MetricaModelo }) {
  const c = m.clasificacion;
  if (!c) return <p className="pcard__p">La matriz de confusión aparece después del próximo reentrenamiento.</p>;
  const kpis: [string, string, string][] = [
    ["Accuracy", pct(c.acierto, 1), AYUDA.acierto], ["Precisión", pct(c.precision, 1), AYUDA.precision],
    ["Recall", pct(c.recall, 1), AYUDA.recall], ["F1", num(c.f1, 2), AYUDA.f1], ["AUC", num(c.auc, 2), AYUDA.auc],
    ["Brier × 100", `${nf(m.error, 1)} vs ${nf(m.errorBase, 1)} base`, AYUDA.brier],
  ];
  return (
    <div className="ml-clas">
      <Matriz c={c} />
      <div>
        <div className="ml-kpis">
          {kpis.map(([t, v, a]) => <div key={t} title={a} className="ml-ayuda-b"><span>{t}</span><b className="mono">{v}</b></div>)}
        </div>
        <p className="pcard__p ml-nota">
          {nf(m.filasPrueba)} ciclos de prueba, {pct(c.tasaPrueba, 1)} con desvío. Umbral de alarma: {pct(c.umbral)} de riesgo.
          Un modelo que dijera siempre «sin desvío» tendría {pct(1 - c.tasaPrueba, 1)} de accuracy sin detectar ninguno:
          por eso se miran el recall y el AUC. Estado: {m.util ? "en uso" : "no supera la base"} ({signo(m.mejora)} sobre la tasa histórica).
        </p>
      </div>
    </div>
  );
}

/** Random Forest contra el modelo lineal, mismas filas de entrenamiento y misma prueba. */
function Comparacion({ metricas }: { metricas: MetricaModelo[] }) {
  const filas = metricas.filter((m) => m.lineal);
  if (!filas.length) return <p className="pcard__p">La comparación aparece después del próximo reentrenamiento.</p>;
  const mejor = (m: MetricaModelo) => {
    const a = m.error, b = m.lineal!.error;
    if (Math.abs(a - b) / Math.max(a, b, 1e-9) < 0.02) return "empate";
    return a < b ? "rf" : "lineal";
  };
  const ganaRf = filas.filter((m) => mejor(m) === "rf").length;
  const ganaLin = filas.filter((m) => mejor(m) === "lineal").length;
  return (
    <>
      <div className="ml-scroll">
        <table className="ds-t ml-t">
          <thead>
            <tr>
              <th>Qué predice</th><th>Modelo alternativo</th>
              <Th ayuda={`${AYUDA.mae} En el riesgo: ${AYUDA.brier}`}>Error RF</Th><Th ayuda="El mismo error, del modelo alternativo.">Error alternativo</Th>
              <Th ayuda={`${AYUDA.r2} En el riesgo se muestra el AUC.`}>R² / AUC RF</Th><Th ayuda="R² o AUC del modelo alternativo.">R² / AUC alternativo</Th>
              <Th ayuda={AYUDA.mejora}>Mejora RF / alt.</Th><th>Menor error</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((m) => {
              const l = m.lineal!, g = mejor(m);
              return (
                <tr key={m.id}>
                  <td>{m.nombre}</td>
                  <td>{l.modelo}</td>
                  <td className={`mono${g === "rf" ? " ml-gana" : ""}`}>{valor(m, m.error)}</td>
                  <td className={`mono${g === "lineal" ? " ml-gana" : ""}`}>{valor(m, l.error)}</td>
                  <td className="mono">{m.id === "riesgo" ? num(m.clasificacion?.auc, 3) : num(m.r2)}</td>
                  <td className="mono">{m.id === "riesgo" ? num(l.auc, 3) : num(l.r2)}</td>
                  <td className="mono">{signo(m.mejora)} / {signo(l.mejora)}</td>
                  <td>{g === "empate" ? <span className="st st--none"><i />Empate</span> : g === "rf" ? <span className="st st--ok"><i />Random Forest</span> : <span className="st st--warn"><i />{l.modelo}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pcard__p ml-nota">
        Random Forest tiene menor error en {ganaRf} de {filas.length} modelos{ganaLin ? `; el modelo lineal, en ${ganaLin}` : ""}.
        Diferencias menores a 2 % se cuentan como empate. Donde el lineal empata o gana, la relación es casi lineal en estos datos:
        la comparación se repite sola en cada reentrenamiento y debe revisarse cuando entren ciclos reales.
      </p>
    </>
  );
}

function RealVsPredicho({ m }: { m: MetricaModelo }) {
  const puntos = m.puntos ?? [];
  if (!puntos.length) return <p className="pcard__p">Sin puntos de prueba publicados para este modelo.</p>;
  const vs = puntos.flatMap((p) => [p.r, p.p]);
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.04 || 1;
  const dom: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)];
  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
          <CartesianGrid stroke="#1D3049" />
          <XAxis type="number" dataKey="r" name="Real" domain={dom} tick={EJE} stroke="#2A415E"
            label={{ value: `Real (${m.unidad})`, position: "insideBottom", offset: -10, ...EJE }} />
          <YAxis type="number" dataKey="p" name="Predicho" domain={dom} tick={EJE} stroke="#2A415E" width={52}
            label={{ value: "Predicho", angle: -90, position: "insideLeft", offset: 12, ...EJE }} />
          <ReferenceLine segment={[{ x: dom[0], y: dom[0] }, { x: dom[1], y: dom[1] }]} stroke="#8CA1B8" strokeDasharray="4 4" ifOverflow="extendDomain" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0E1B2E", border: "1px solid #2A415E", fontSize: 12 }}
            formatter={(v) => `${nf(Number(v), decimales(m))} ${m.unidad}`} />
          <Scatter data={puntos} fill="#2FB7E8" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function Detalle({ metricas }: { metricas: MetricaModelo[] }) {
  const [id, setId] = useState(metricas[0]?.id);
  const m = metricas.find((x) => x.id === id) ?? metricas[0];
  if (!m) return null;
  return (
    <>
      <div className="ml-tabs" role="tablist">
        {metricas.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === m.id} className={`btn2 btn2--s${x.id === m.id ? " btn2--pri" : ""}`} onClick={() => setId(x.id)}>{x.nombre}</button>
        ))}
      </div>
      <div className="ml-det">
        <div>
          <p className="kpi__l" style={{ marginBottom: 6 }}>Real contra predicho · ciclos de prueba</p>
          {m.id === "riesgo"
            ? <p className="pcard__p">El riesgo es una probabilidad: su calidad se lee en la matriz de confusión y el AUC.</p>
            : <><RealVsPredicho m={m} /><p className="pcard__p ml-nota">Cada punto es un ciclo que el modelo no vio. Sobre la diagonal, la predicción es exacta; los puntos sobre ella sobrestiman y bajo ella subestiman.</p></>}
        </div>
        <div className="ml-fact">
          <p className="kpi__l" style={{ marginBottom: 8 }}>Variables que más pesan</p>
          {m.factores.map((f) => (
            <div className="ml-f" key={f.n}><span>{f.n}</span><i><b style={{ width: `${f.peso * 100}%` }} /></i><em className="mono">{nf(f.peso * 100)} %</em></div>
          ))}
          <p className="pcard__p ml-nota">Importancia de cada variable dentro del Random Forest, normalizada a 100 %.</p>
        </div>
      </div>
    </>
  );
}

export default function CalidadModelos({ ml }: { ml: ML }) {
  const regresores = ml.metricas.filter((m) => (m.tipo ?? (m.id === "riesgo" ? "clasificacion" : "regresion")) === "regresion");
  const riesgo = ml.metricas.find((m) => m.id === "riesgo");
  const prueba = Math.round((ml.fraccionPrueba ?? 0.2) * 100);
  return (
    <section className="card pcard ml-card">
      <p className="pcard__t" style={{ marginBottom: 4 }}>Calidad de los modelos de machine learning</p>
      <p className="pcard__p">
        {ml.algoritmo} de {ml.arboles} árboles{ml.profundidad ? ` (profundidad máxima ${ml.profundidad})` : ""}, entrenados con {nf(ml.ciclos)} ciclos <b>simulados</b>.
        Validación temporal: se entrena con el {100 - prueba} % más antiguo y se mide con el {prueba} % más reciente, que el modelo no vio.
        Un modelo se usa solo si reduce al menos {nf((ml.mejoraMinima ?? 0.05) * 100)} % el error de predecir el promedio. Pasa el mouse sobre cada columna para ver qué mide.
      </p>

      <h3 className="ml-sec">Regresión · tiempos y consumos</h3>
      <TablaRegresion metricas={regresores} />

      {riesgo && (<><h3 className="ml-sec">Clasificación · riesgo de desvío</h3><Clasificador m={riesgo} /></>)}

      <h3 className="ml-sec">Comparación con otro modelo</h3>
      <Comparacion metricas={ml.metricas} />

      <h3 className="ml-sec">Detalle por modelo</h3>
      <Detalle metricas={ml.metricas} />

      <details className="ml-glos">
        <summary>Cómo leer estas métricas</summary>
        <dl>
          {([["MAE", AYUDA.mae], ["RMSE", AYUDA.rmse], ["R²", `${AYUDA.r2} Puede salir alto aunque la mejora sea baja: los circuitos tienen consumos muy distintos y eso ya explica gran parte de la variación. La mejora sobre el promedio del circuito es la medida exigente.`],
            ["MAE entrenamiento", AYUDA.entrenamiento], ["MAE promedio y mejora", `${AYUDA.base} ${AYUDA.mejora}`], ["Margen y cobertura", `${AYUDA.margen} ${AYUDA.cobertura}`],
            ["Matriz de confusión", "Cruza lo real con lo predicho. Los falsos negativos son desvíos que el modelo no anticipó; los falsos positivos, alarmas que no ocurrieron."],
            ["Accuracy", AYUDA.acierto], ["Precisión", AYUDA.precision], ["Recall", AYUDA.recall], ["F1", AYUDA.f1], ["AUC", AYUDA.auc], ["Brier", AYUDA.brier],
            ["Modelo alternativo", "Regresión lineal múltiple (mínimos cuadrados) para tiempos y consumos, y regresión logística para el riesgo. Usan las mismas variables, el mismo entrenamiento y la misma prueba que el Random Forest; circuito y día de la semana entran como categorías."],
          ] as [string, string][]).map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
      </details>
    </section>
  );
}
