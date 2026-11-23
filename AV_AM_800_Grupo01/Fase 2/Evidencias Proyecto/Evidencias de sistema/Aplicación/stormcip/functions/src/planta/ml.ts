// Modelos de machine learning de Storm CIP: Random Forest entrenados con la historia
// de ciclos cada vez que cierra uno.
//   · limpio:      segundos hasta agua limpia de un enjuague, antes de que empiece.
//   · limpioVivo:  lo mismo, ya con la conductividad al 15 % de la fase.
//   · agua, quimico: consumo del próximo ciclo.
//   · riesgo:      probabilidad de que el próximo ciclo tenga un desvío.
// Cada modelo se mide con los ciclos más recientes, que no vio al entrenar, y contra
// una base simple (el promedio del circuito). Si no le gana, se declara no útil.
// Como evidencia, cada modelo se compara además con un modelo lineal entrenado y
// probado con las mismas filas: regresión lineal para los consumos y tiempos,
// regresión logística para el riesgo.
import { RandomForestClassifier, RandomForestRegression } from "ml-random-forest";
import { CIRCUITOS, Circuito, Contexto, contextoPara } from "./motor";
import { CicloDecision, Decision, Prediccion, calcularDecisiones, percentil } from "./decisiones";

export const CONFIG_ML = {
  minFilas: 60, fraccionPrueba: 0.2, arboles: 40, seed: 42,
  /** Entrenar cuesta: se usan las filas más recientes de cada modelo. */
  maxFilas: 900,
  /** Debe bajar el error de la base al menos este tanto para declararse útil. */
  mejoraMinima: 0.05,
  /** Probabilidad desde la que el clasificador anuncia un desvío (para la matriz de confusión). */
  umbralRiesgo: 0.5,
};
const ARBOL = { maxDepth: 8, minNumSamples: 4 };

export type CicloML = CicloDecision & { contexto?: Contexto };

/**
 * Número estable del circuito para el modelo. Los de fábrica conservan su índice;
 * un plan creado por el administrador recibe uno propio derivado de su id.
 */
export const iCircuito = (id: string) => {
  const i = CIRCUITOS.findIndex((c) => c.id === id);
  if (i >= 0) return i;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CIRCUITOS.length + (h % 64);
};
const baseCtx = (c: Contexto) => [c.horasDesdeUltima, c.carga, c.tempAgua, c.activos, c.diaSemana];
const NOMBRES_CTX = ["Horas sin limpiar", "Carga de producto", "Temperatura del agua", "Equipos activos", "Día de la semana"];

/**
 * `k`: escala propia de la fila. Agua y químico se aprenden relativos al consumo reciente
 * del circuito: 820 L y 5.900 L no son comparables, pero sí «5 % sobre lo habitual».
 */
type Fila = { x: number[]; y: number; base: string; t: number; k?: number };

/** El mismo problema resuelto con un modelo lineal, para comparar contra el Random Forest. */
export type Comparacion = {
  modelo: string; error: number; rmse: number | null; r2: number | null; auc: number | null; mejora: number; util: boolean;
};
/** Matriz de confusión y métricas derivadas del clasificador, en los ciclos de prueba. */
export type Clasificacion = {
  umbral: number; vp: number; fp: number; vn: number; fn: number; tasaPrueba: number;
  acierto: number; precision: number | null; recall: number | null; f1: number | null; auc: number | null;
};
/**
 * Calidad de un modelo, medida con los ciclos más recientes que no vio al entrenar.
 * Regresión: `error` es MAE. Clasificación: `error` es Brier × 100.
 */
export type Metrica = {
  id: string; nombre: string; unidad: string; tipo: "regresion" | "clasificacion";
  filas: number; filasPrueba: number;
  error: number; errorBase: number; mejora: number;
  /** Mismo error, medido en los datos de entrenamiento: si es mucho menor, el modelo memoriza. */
  errorEntrenamiento: number;
  rmse: number | null; r2: number | null; cobertura: number | null;
  margen: number; util: boolean; factores: { n: string; peso: number }[];
  /** Real contra predicho en la prueba (muestra). Objetos: Firestore no acepta arreglos anidados. */
  puntos: { r: number; p: number }[];
  lineal: Comparacion | null;
  clasificacion: Clasificacion | null;
};
type Regresor = { predecir: (x: number[], k?: number) => number; margen: number; metrica: Metrica };

const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
const red = (v: number, d: number) => +v.toFixed(d);
const MAX_PUNTOS = 120;
const muestra = <T>(v: T[], n: number) => (v.length <= n ? v : Array.from({ length: n }, (_, i) => v[Math.floor((i * v.length) / n)]));

/** Columnas que el modelo lineal trata como categorías (una columna 0/1 por valor). */
const CATEGORICAS = new Set(["Circuito", "Día de la semana"]);

/** Resuelve A·x = b por eliminación de Gauss con pivoteo parcial. */
function resolver(A: number[][], b: number[]) {
  const n = b.length, M = A.map((f, i) => [...f, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) continue;
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Diseño del modelo lineal: intercepto, variables numéricas estandarizadas con la media
 * y desviación del entrenamiento, y una columna 0/1 por cada valor de las categóricas
 * (el primero queda de referencia). Un valor que no vio cae en la referencia.
 */
function diseno(xs: number[][], categoricas: number[]) {
  const d = xs[0].length;
  const niveles = new Map(categoricas.map((j) => [j, [...new Set(xs.map((x) => x[j]))].sort((a, b) => a - b).slice(1)]));
  const num = Array.from({ length: d }, (_, j) => j).filter((j) => !niveles.has(j));
  const mu = num.map((j) => media(xs.map((x) => x[j])));
  const sd = num.map((j, i) => Math.sqrt(media(xs.map((x) => (x[j] - mu[i]) ** 2))) || 1);
  return (x: number[]) => {
    const out = [1];
    num.forEach((j, i) => out.push((x[j] - mu[i]) / sd[i]));
    for (const [j, vs] of niveles) for (const v of vs) out.push(x[j] === v ? 1 : 0);
    return out;
  };
}

/** Penalización ridge chica: solo evita que columnas casi iguales vuelvan inestable la solución. */
const LAMBDA = 1e-3;

/** Regresión lineal múltiple por mínimos cuadrados (ecuaciones normales). */
export function ajustarLineal(xs: number[][], ys: number[], categoricas: number[] = []) {
  const fila = diseno(xs, categoricas);
  const X = xs.map(fila), p = X[0].length, n = X.length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  X.forEach((r, k) => {
    for (let i = 0; i < p; i++) {
      b[i] += r[i] * ys[k];
      for (let j = 0; j < p; j++) A[i][j] += r[i] * r[j];
    }
  });
  for (let i = 1; i < p; i++) A[i][i] += LAMBDA * n;
  const beta = resolver(A, b);
  return (x: number[]) => fila(x).reduce((s, v, i) => s + v * beta[i], 0);
}

const sigmoide = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Regresión logística ajustada por Newton-Raphson (IRLS). Devuelve la probabilidad de clase 1. */
export function ajustarLogistica(xs: number[][], ys: number[], categoricas: number[] = []) {
  const fila = diseno(xs, categoricas);
  const X = xs.map(fila), p = X[0].length, n = X.length;
  let beta = new Array(p).fill(0);
  for (let it = 0; it < 25; it++) {
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
    X.forEach((r, k) => {
      const pr = sigmoide(r.reduce((s, v, i) => s + v * beta[i], 0)), w = Math.max(pr * (1 - pr), 1e-6);
      for (let i = 0; i < p; i++) {
        g[i] += r[i] * (ys[k] - pr);
        for (let j = 0; j < p; j++) A[i][j] += w * r[i] * r[j];
      }
    });
    for (let i = 1; i < p; i++) { A[i][i] += LAMBDA * n; g[i] -= LAMBDA * n * beta[i]; }
    const paso = resolver(A, g);
    beta = beta.map((v, i) => v + paso[i]);
    if (Math.max(...paso.map(Math.abs)) < 1e-6) break;
  }
  return (x: number[]) => sigmoide(fila(x).reduce((s, v, i) => s + v * beta[i], 0));
}

/** MAE, RMSE y R² de una predicción contra lo real. */
export function medirRegresion(reales: number[], pred: number[]) {
  const m = media(reales);
  const ssRes = reales.reduce((s, y, i) => s + (y - pred[i]) ** 2, 0);
  const ssTot = reales.reduce((s, y) => s + (y - m) ** 2, 0) || 1;
  return {
    mae: media(reales.map((y, i) => Math.abs(y - pred[i]))),
    rmse: Math.sqrt(ssRes / Math.max(reales.length, 1)),
    r2: 1 - ssRes / ssTot,
  };
}

/** Área bajo la curva ROC: probabilidad de que un desvío reciba más riesgo que un ciclo sano. */
export function auc(proba: number[], ys: number[]) {
  const pos = proba.filter((_, i) => ys[i] === 1), neg = proba.filter((_, i) => ys[i] === 0);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/** Matriz de confusión y lo que se deriva de ella, con un umbral de probabilidad. */
export function medirClasificacion(proba: number[], ys: number[], umbral: number): Clasificacion {
  let vp = 0, fp = 0, vn = 0, fn = 0;
  proba.forEach((p, i) => {
    const pred = p >= umbral ? 1 : 0;
    if (pred === 1 && ys[i] === 1) vp++;
    else if (pred === 1) fp++;
    else if (ys[i] === 1) fn++;
    else vn++;
  });
  const precision = vp + fp ? vp / (vp + fp) : null;
  const recall = vp + fn ? vp / (vp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const a = auc(proba, ys);
  const o = (v: number | null) => (v === null ? null : red(v, 3));
  return {
    umbral, vp, fp, vn, fn, tasaPrueba: red(media(ys), 3), acierto: red((vp + vn) / Math.max(ys.length, 1), 3),
    precision: o(precision), recall: o(recall), f1: o(f1), auc: o(a),
  };
}

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

const categoricasDe = (nombres: string[]) => nombres.flatMap((n, i) => (CATEGORICAS.has(n) ? [i] : []));

export function entrenarRegresor(id: string, nombre: string, unidad: string, filas: Fila[], nombres: string[]): Regresor | null {
  if (filas.length < CONFIG_ML.minFilas) return null;
  const { train, test, todas } = dividir(filas);
  const escala = (f: Fila) => f.k ?? 1;
  const xs = (s: Fila[]) => s.map((f) => f.x), ys = (s: Fila[]) => s.map((f) => f.y / escala(f));
  const modelo = bosque(xs(train), ys(train));
  const predDe = (s: Fila[]) => (modelo.predict(xs(s)) as number[]).map((v, i) => v * escala(s[i]));
  const pred = predDe(test);
  const reales = test.map((f) => f.y);

  // Base: el promedio del mismo grupo (circuito/fase) en el entrenamiento
  const grupos = new Map<string, number[]>();
  for (const f of train) grupos.set(f.base, [...(grupos.get(f.base) ?? []), f.y]);
  const mediaTrain = media(train.map((f) => f.y));
  const predBase = test.map((f) => media(grupos.get(f.base) ?? [mediaTrain]));

  const errores = test.map((f, i) => Math.abs(f.y - pred[i]));
  const rf = medirRegresion(reales, pred);
  const error = rf.mae;
  const errorBase = media(test.map((f, i) => Math.abs(f.y - predBase[i])));
  const errorEntrenamiento = medirRegresion(train.map((f) => f.y), predDe(train)).mae;
  const mejoraDe = (e: number) => (errorBase > 0 ? 1 - e / errorBase : 0);

  // Margen calibrado con la primera mitad de la prueba y verificado en la segunda
  const mitad = Math.floor(test.length / 2);
  const margen = percentil(errores.slice(0, mitad), 90);
  const verif = errores.slice(mitad);
  const cobertura = verif.length ? verif.filter((e) => e <= margen).length / verif.length : null;

  // El mismo problema con regresión lineal, mismas filas y misma prueba
  const lineal = ajustarLineal(xs(train), ys(train), categoricasDe(nombres));
  const lin = medirRegresion(reales, test.map((f) => lineal(f.x) * escala(f)));

  const final = bosque(xs(todas), ys(todas));
  const mejora = mejoraDe(error);
  return {
    predecir: (x, k = 1) => (final.predict([x]) as number[])[0] * k, margen,
    metrica: {
      id, nombre, unidad, tipo: "regresion", filas: todas.length, filasPrueba: test.length,
      error: red(error, 2), errorBase: red(errorBase, 2), mejora: red(mejora, 3), errorEntrenamiento: red(errorEntrenamiento, 2),
      rmse: red(rf.rmse, 2), r2: red(rf.r2, 3), cobertura: cobertura === null ? null : red(cobertura, 3),
      margen: red(margen, 2), util: mejora >= CONFIG_ML.mejoraMinima,
      factores: factoresDe(final as never, nombres),
      puntos: muestra(test.map((f, i) => ({ r: red(f.y, 2), p: red(pred[i], 2) })), MAX_PUNTOS),
      lineal: {
        modelo: "Regresión lineal", error: red(lin.mae, 2), rmse: red(lin.rmse, 2), r2: red(lin.r2, 3), auc: null,
        mejora: red(mejoraDe(lin.mae), 3), util: mejoraDe(lin.mae) >= CONFIG_ML.mejoraMinima,
      },
      clasificacion: null,
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
  const probaDe = (s: Fila[]) => m.predictProbability(s.map((f) => f.x), 1) as number[];
  const proba = probaDe(test);
  const ys = test.map((f) => f.y);
  const tasa = media(train.map((f) => f.y));
  // Brier: error cuadrático de la probabilidad; la base siempre dice la tasa histórica
  const brierDe = (p: number[], s: Fila[]) => media(s.map((f, i) => (p[i] - f.y) ** 2));
  const brier = brierDe(proba, test);
  const brierBase = media(test.map((f) => (tasa - f.y) ** 2));
  const mejoraDe = (b: number) => (brierBase > 0 ? 1 - b / brierBase : 0);

  // El mismo problema con regresión logística
  const logistica = ajustarLogistica(train.map((f) => f.x), train.map((f) => f.y), categoricasDe(nombres));
  const probaLog = test.map((f) => logistica(f.x));
  const brierLog = brierDe(probaLog, test);
  const aucLog = auc(probaLog, ys);

  const final = crear(todas);
  const mejora = mejoraDe(brier);
  return {
    predecir: (x: number[]) => (final.predictProbability([x], 1) as number[])[0],
    metrica: {
      id: "riesgo", nombre: "Riesgo de desvío", unidad: "%", tipo: "clasificacion", filas: todas.length, filasPrueba: test.length,
      error: red(brier * 100, 1), errorBase: red(brierBase * 100, 1), mejora: red(mejora, 3),
      errorEntrenamiento: red(brierDe(probaDe(train), train) * 100, 1),
      rmse: null, r2: null, cobertura: null, margen: 0, util: mejora >= CONFIG_ML.mejoraMinima,
      factores: factoresDe(final as never, nombres), puntos: [],
      lineal: {
        modelo: "Regresión logística", error: red(brierLog * 100, 1), rmse: null, r2: null, auc: aucLog === null ? null : red(aucLog, 3),
        mejora: red(mejoraDe(brierLog), 3), util: mejoraDe(brierLog) >= CONFIG_ML.mejoraMinima,
      },
      clasificacion: medirClasificacion(proba, ys, CONFIG_ML.umbralRiesgo),
    } satisfies Metrica,
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

export function entrenarModelos(ciclos: CicloML[], circuitos: Circuito[] = CIRCUITOS) {
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
    const c = circuitos.find((x) => x.id === circuitoId);
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
export function analizar(ciclos: CicloML[], ahoraMs: number, circuitos: Circuito[] = CIRCUITOS) {
  const ml = entrenarModelos(ciclos, circuitos);
  const base = calcularDecisiones(ciclos, ahoraMs, undefined, { superior: ml.superior, modelo: ml.metricas.find((m) => m.id === "limpio")?.util === true });
  const manana = new Date(ahoraMs + 86400000);
  // Cada predicción guarda las condiciones que supuso: el ciclo de demo corre con esas
  const predicciones: (Prediccion & { ml?: PrediccionCiclo; contexto?: Contexto })[] = base.predicciones.map((p) => {
    const c = circuitos.find((x) => x.id === p.circuitoId);
    if (!c) return p;
    const contexto = contextoPara(c, manana, Math.floor(ahoraMs / 86400000) + iCircuito(c.id));
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
    ml: {
      metricas: ml.metricas, ciclos: ml.filas, algoritmo: "Random Forest", arboles: CONFIG_ML.arboles,
      profundidad: ARBOL.maxDepth, fraccionPrueba: CONFIG_ML.fraccionPrueba, mejoraMinima: CONFIG_ML.mejoraMinima,
    },
  };
}
