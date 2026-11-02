// Modelos de machine learning de Storm CIP: Random Forest entrenados con la historia
// de ciclos cada vez que cierra uno.
//   · limpio:      segundos hasta agua limpia de un enjuague, antes de que empiece.
//   · limpioVivo:  lo mismo, ya con la conductividad al 15 % de la fase.
//   · agua, quimico: consumo del próximo ciclo.
//   · riesgo:      probabilidad de que el próximo ciclo tenga un desvío.
// Cada modelo se mide con los ciclos más recientes, que no vio al entrenar, y contra
// una base simple (el promedio del circuito). Si no le gana, se declara no útil.
import { RandomForestClassifier, RandomForestRegression } from "ml-random-forest";
import { CIRCUITOS, Contexto, contextoPara } from "./motor";
import { CicloDecision, Decision, Prediccion, calcularDecisiones, percentil } from "./decisiones";

export const CONFIG_ML = {
  minFilas: 60, fraccionPrueba: 0.2, arboles: 40, seed: 42,
  /** Entrenar cuesta: se usan las filas más recientes de cada modelo. */
  maxFilas: 900,
  /** Debe bajar el error de la base al menos este tanto para declararse útil. */
  mejoraMinima: 0.05,
};
const ARBOL = { maxDepth: 8, minNumSamples: 4 };

export type CicloML = CicloDecision & { contexto?: Contexto };

const iCircuito = (id: string) => CIRCUITOS.findIndex((c) => c.id === id);
const baseCtx = (c: Contexto) => [c.horasDesdeUltima, c.carga, c.tempAgua, c.activos, c.diaSemana];
const NOMBRES_CTX = ["Horas sin limpiar", "Carga de producto", "Temperatura del agua", "Equipos activos", "Día de la semana"];

/**
 * `k`: escala propia de la fila. Agua y químico se aprenden relativos al consumo reciente
 * del circuito: 820 L y 5.900 L no son comparables, pero sí «5 % sobre lo habitual».
 */
type Fila = { x: number[]; y: number; base: string; t: number; k?: number };
export type Metrica = {
  id: string; nombre: string; unidad: string; filas: number; filasPrueba: number;
  error: number; errorBase: number; mejora: number; r2: number; cobertura: number | null;
  margen: number; util: boolean; factores: { n: string; peso: number }[];
};
type Regresor = { predecir: (x: number[], k?: number) => number; margen: number; metrica: Metrica };

const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);

function bosque(xs: number[][], ys: number[]) {
  const m = new RandomForestRegression({
    nEstimators: CONFIG_ML.arboles, seed: CONFIG_ML.seed, maxFeatures: 0.8, replacement: false, noOOB: true,
    treeOptions: ARBOL, useSampleBagging: true,
  } as never);
  m.train(xs, ys);
  return m;
}

/** División temporal: el modelo se prueba con el futuro, nunca con ciclos mezclados. */
function dividir(filas: Fila[]) {
  const orden = [...filas].sort((a, b) => a.t - b.t).slice(-CONFIG_ML.maxFilas);
  const corte = Math.floor(orden.length * (1 - CONFIG_ML.fraccionPrueba));
  return { train: orden.slice(0, corte), test: orden.slice(corte), todas: orden };
}

function factoresDe(m: { featureImportance: () => number[] }, nombres: string[]) {
  const imp = m.featureImportance();
  const total = imp.reduce((a, b) => a + b, 0) || 1;
  return imp.map((p, i) => ({ n: nombres[i], peso: +(p / total).toFixed(3) })).sort((a, b) => b.peso - a.peso).slice(0, 4);
}

export function entrenarRegresor(id: string, nombre: string, unidad: string, filas: Fila[], nombres: string[]): Regresor | null {
  if (filas.length < CONFIG_ML.minFilas) return null;
  const { train, test, todas } = dividir(filas);
  const modelo = bosque(train.map((f) => f.x), train.map((f) => f.y / (f.k ?? 1)));
  const pred = (modelo.predict(test.map((f) => f.x)) as number[]).map((v, i) => v * (test[i].k ?? 1));

  // Base: el promedio del mismo grupo (circuito/fase) en el entrenamiento
  const grupos = new Map<string, number[]>();
  for (const f of train) grupos.set(f.base, [...(grupos.get(f.base) ?? []), f.y]);
  const mediaTrain = media(train.map((f) => f.y));
  const predBase = test.map((f) => media(grupos.get(f.base) ?? [mediaTrain]));

  const errores = test.map((f, i) => Math.abs(f.y - pred[i]));
  const error = media(errores);
  const errorBase = media(test.map((f, i) => Math.abs(f.y - predBase[i])));
  const mediaTest = media(test.map((f) => f.y));
  const ssRes = test.reduce((s, f, i) => s + (f.y - pred[i]) ** 2, 0);
  const ssTot = test.reduce((s, f) => s + (f.y - mediaTest) ** 2, 0) || 1;

  // Margen calibrado con la primera mitad de la prueba y verificado en la segunda
  const mitad = Math.floor(test.length / 2);
  const margen = percentil(errores.slice(0, mitad), 90);
  const verif = errores.slice(mitad);
  const cobertura = verif.length ? verif.filter((e) => e <= margen).length / verif.length : null;

  const final = bosque(todas.map((f) => f.x), todas.map((f) => f.y / (f.k ?? 1)));
  const mejora = errorBase > 0 ? 1 - error / errorBase : 0;
  return {
    predecir: (x, k = 1) => (final.predict([x]) as number[])[0] * k, margen,
    metrica: {
      id, nombre, unidad, filas: todas.length, filasPrueba: test.length,
      error: +error.toFixed(2), errorBase: +errorBase.toFixed(2), mejora: +mejora.toFixed(3),
      r2: +(1 - ssRes / ssTot).toFixed(3), cobertura: cobertura === null ? null : +cobertura.toFixed(3),
      margen: +margen.toFixed(2), util: mejora >= CONFIG_ML.mejoraMinima,
      factores: factoresDe(final as never, nombres),
    },
  };
}

function entrenarRiesgo(filas: Fila[], nombres: string[]) {
  if (filas.length < CONFIG_ML.minFilas || new Set(filas.map((f) => f.y)).size < 2) return null;
  const { train, test, todas } = dividir(filas);
  const crear = (s: Fila[]) => {
    const m = new RandomForestClassifier({
      nEstimators: CONFIG_ML.arboles, seed: CONFIG_ML.seed, maxFeatures: 0.8, replacement: false, noOOB: true, treeOptions: ARBOL, useSampleBagging: true,
    } as never);
    m.train(s.map((f) => f.x), s.map((f) => f.y));
    return m;
  };
  const m = crear(train);
  const clases = new Set(train.map((f) => f.y));
  if (clases.size < 2) return null;
  const proba = m.predictProbability(test.map((f) => f.x), 1) as number[];
  const tasa = media(train.map((f) => f.y));
  // Brier: error cuadrático de la probabilidad; la base siempre dice la tasa histórica
  const brier = media(test.map((f, i) => (proba[i] - f.y) ** 2));
  const brierBase = media(test.map((f) => (tasa - f.y) ** 2));
  const acierto = media(test.map((f, i) => ((proba[i] >= 0.5 ? 1 : 0) === f.y ? 1 : 0)));
  const final = crear(todas);
  const mejora = brierBase > 0 ? 1 - brier / brierBase : 0;
  return {
    predecir: (x: number[]) => (final.predictProbability([x], 1) as number[])[0],
    metrica: {
      id: "riesgo", nombre: "Riesgo de desvío", unidad: "%", filas: todas.length, filasPrueba: test.length,
      error: +(brier * 100).toFixed(1), errorBase: +(brierBase * 100).toFixed(1), mejora: +mejora.toFixed(3),
      r2: +acierto.toFixed(3), cobertura: null, margen: 0, util: mejora >= CONFIG_ML.mejoraMinima,
      factores: factoresDe(final as never, nombres),
    } as Metrica,
  };
}

const NOMBRES_LIMPIO = ["Circuito", "Tipo de enjuague", "Duración de la fase", ...NOMBRES_CTX];
const NOMBRES_VIVO = ["Circuito", "Tipo de enjuague", "Duración de la fase", "Conductividad al 15 %", "Carga de producto"];
const NOMBRES_CONSUMO = ["Circuito", ...NOMBRES_CTX];
const NOMBRES_RIESGO = ["Circuito", ...NOMBRES_CTX, "Desvíos en los últimos 10 ciclos"];

const xLimpio = (ci: number, fase: string, durS: number, c: Contexto) => [ci, fase === "Enjuague final" ? 1 : 0, durS, ...baseCtx(c)];
const xVivo = (ci: number, fase: string, durS: number, ec15: number, c: Contexto) => [ci, fase === "Enjuague final" ? 1 : 0, durS, ec15, c.carga];

export type PrediccionCiclo = {
  aguaL: number; aguaMargen: number; quimicoL: number; quimicoMargen: number; riesgo: number;
  limpio: Record<string, { s: number; margen: number }>;
};

export function entrenarModelos(ciclos: CicloML[]) {
  const orden = [...ciclos].filter((c) => c.contexto).sort((a, b) => a.inicioMs - b.inicioMs);
  const limpio: Fila[] = [], vivo: Fila[] = [], agua: Fila[] = [], quim: Fila[] = [], riesgo: Fila[] = [];
  const historia = new Map<string, CicloML[]>();
  const rolling = (id: string) => {
    const h = historia.get(id) ?? [];
    const ult = h.slice(-5);
    return {
      agua: ult.length ? media(ult.map((c) => c.resumen.aguaL)) : 0,
      quim: ult.length ? media(ult.map((c) => c.resumen.quimicoL)) : 0,
      desvios: h.slice(-10).filter((c) => c.resumen.validacion !== "validado").length,
    };
  };
  for (const c of orden) {
    const ci = iCircuito(c.circuitoId), ctx = c.contexto!;
    const r = rolling(c.circuitoId);
    for (const f of c.resumen.fases) {
      if (f.limpioS === null) continue;
      limpio.push({ x: xLimpio(ci, f.n, f.durS, ctx), y: f.limpioS, base: `${c.circuitoId}|${f.n}`, t: c.inicioMs });
      if (typeof f.ec15 === "number") vivo.push({ x: xVivo(ci, f.n, f.durS, f.ec15, ctx), y: f.limpioS, base: `${c.circuitoId}|${f.n}`, t: c.inicioMs });
    }
    // Las primeras filas sin historia no enseñan el efecto del consumo reciente
    if ((historia.get(c.circuitoId) ?? []).length >= 5) {
      agua.push({ x: [ci, ...baseCtx(ctx)], y: c.resumen.aguaL, k: r.agua, base: c.circuitoId, t: c.inicioMs });
      quim.push({ x: [ci, ...baseCtx(ctx)], y: c.resumen.quimicoL, k: r.quim, base: c.circuitoId, t: c.inicioMs });
      riesgo.push({ x: [ci, ...baseCtx(ctx), r.desvios], y: c.resumen.validacion === "validado" ? 0 : 1, base: c.circuitoId, t: c.inicioMs });
    }
    historia.set(c.circuitoId, [...(historia.get(c.circuitoId) ?? []), c]);
  }

  const mLimpio = entrenarRegresor("limpio", "Tiempo hasta agua limpia", "s", limpio, NOMBRES_LIMPIO);
  const mVivo = entrenarRegresor("limpioVivo", "Agua limpia, durante el enjuague", "s", vivo, NOMBRES_VIVO);
  const mAgua = entrenarRegresor("agua", "Agua por ciclo", "L", agua, NOMBRES_CONSUMO);
  const mQuim = entrenarRegresor("quimico", "Químico por ciclo", "L", quim, NOMBRES_CONSUMO);
  const mRiesgo = entrenarRiesgo(riesgo, NOMBRES_RIESGO);
  const metricas = [mLimpio, mVivo, mAgua, mQuim, mRiesgo].flatMap((m) => (m ? [m.metrica] : []));

  /** Predicción para un ciclo que aún no empieza. */
  function predecirCiclo(circuitoId: string, ctx: Contexto): PrediccionCiclo | null {
    if (!mAgua || !mQuim) return null;
    const c = CIRCUITOS.find((x) => x.id === circuitoId);
    if (!c) return null;
    const ci = iCircuito(circuitoId), r = rolling(circuitoId);
    const limpioPorFase: PrediccionCiclo["limpio"] = {};
    if (mLimpio) for (const f of c.fases.filter((x) => x.enjuague)) {
      limpioPorFase[f.n] = { s: Math.round(Math.min(mLimpio.predecir(xLimpio(ci, f.n, f.s, ctx)), f.s)), margen: Math.round(mLimpio.margen) };
    }
    return {
      aguaL: Math.round(mAgua.predecir([ci, ...baseCtx(ctx)], r.agua)), aguaMargen: Math.round(mAgua.margen),
      quimicoL: +mQuim.predecir([ci, ...baseCtx(ctx)], r.quim).toFixed(1), quimicoMargen: +mQuim.margen.toFixed(1),
      riesgo: mRiesgo ? +mRiesgo.predecir([ci, ...baseCtx(ctx), r.desvios]).toFixed(2) : 0,
      limpio: limpioPorFase,
    };
  }

  /** Con la conductividad ya medida al 15 % de la fase. */
  const predecirEnVivo = (circuitoId: string, fase: string, durS: number, ec15: number, ctx: Contexto) =>
    mVivo ? { s: Math.round(Math.min(mVivo.predecir(xVivo(iCircuito(circuitoId), fase, durS, ec15, ctx)), durS)), margen: Math.round(mVivo.margen) } : null;

  /** Límite superior del tiempo hasta limpio de un ciclo, según el modelo. */
  const superior = (c: CicloML, fase: string, durS: number) =>
    mLimpio && c.contexto ? mLimpio.predecir(xLimpio(iCircuito(c.circuitoId), fase, durS, c.contexto)) + mLimpio.margen : null;

  return { metricas, predecirCiclo, predecirEnVivo, superior, filas: orden.length };
}

/**
 * Modelo chico para el ciclo en vivo: solo su circuito, para que el botón responda al
 * instante. Corrige el tiempo hasta agua limpia con la conductividad ya medida.
 */
export function entrenarEnVivo(ciclos: CicloML[], circuitoId: string) {
  const filas: Fila[] = [];
  for (const c of ciclos) {
    if (c.circuitoId !== circuitoId || !c.contexto) continue;
    for (const f of c.resumen.fases) {
      if (f.limpioS !== null && typeof f.ec15 === "number") {
        filas.push({ x: xVivo(iCircuito(c.circuitoId), f.n, f.durS, f.ec15, c.contexto), y: f.limpioS, base: f.n, t: c.inicioMs });
      }
    }
  }
  const m = entrenarRegresor("limpioVivo", "Agua limpia, durante el enjuague", "s", filas, NOMBRES_VIVO);
  return (fase: string, durS: number, ec15: number, ctx: Contexto) =>
    m ? { s: Math.round(Math.min(m.predecir(xVivo(iCircuito(circuitoId), fase, durS, ec15, ctx)), durS)), margen: Math.round(m.margen) } : null;
}

/** Todo lo que publica la pantalla de Predicción: decisiones y modelos. */
export function analizar(ciclos: CicloML[], ahoraMs: number) {
  const ml = entrenarModelos(ciclos);
  const base = calcularDecisiones(ciclos, ahoraMs, undefined, { superior: ml.superior, modelo: ml.metricas.find((m) => m.id === "limpio")?.util === true });
  const manana = new Date(ahoraMs + 86400000);
  // Cada predicción guarda las condiciones que supuso: el ciclo de demo corre con esas
  const predicciones: (Prediccion & { ml?: PrediccionCiclo; contexto?: Contexto })[] = base.predicciones.map((p) => {
    const c = CIRCUITOS.find((x) => x.id === p.circuitoId);
    if (!c) return p;
    const contexto = contextoPara(c, manana, Math.floor(ahoraMs / 86400000) + CIRCUITOS.indexOf(c));
    const r = ml.predecirCiclo(p.circuitoId, contexto);
    return r ? { ...p, ml: r, contexto } : p;
  });
  // El riesgo alto sube a la lista de atención, aunque el circuito no haya fallado aún
  const decisiones: Decision[] = base.decisiones.map((d) => {
    if (d.tipo !== "revisar_circuito") return d;
    const r = predicciones.find((p) => p.circuitoId === d.circuitoId)?.ml?.riesgo;
    return r === undefined ? d : { ...d, porque: `${d.porque} El modelo estima ${Math.round(r * 100)} % de riesgo de desvío en el próximo ciclo.` };
  });
  return {
    ...base, decisiones, predicciones,
    ml: { metricas: ml.metricas, ciclos: ml.filas, algoritmo: "Random Forest", arboles: CONFIG_ML.arboles },
  };
}
