// Variables del ciclo, sus rangos por fase, la proyección en minutos con su nivel de
// confianza y los avisos de tendencia. Todo se calcula desde la curva del ciclo.
// Sin React ni Firestore, para poder testearlo.
import { CicloPlanta, FaseCiclo, PuntoCurva, faseEn, fechaDe, inicioFase, mmss, nf } from "./planta";

export type VarId = "T" | "c" | "q" | "ec" | "a" | "k";
export type Variable = { id: VarId; nombre: string; corto: string; unidad: string; dec: number };
export const VARIABLES: Variable[] = [
  { id: "T", nombre: "Temperatura de retorno", corto: "Temperatura", unidad: "°C", dec: 1 },
  { id: "c", nombre: "Concentración", corto: "Concentración", unidad: "%", dec: 2 },
  { id: "q", nombre: "Caudal", corto: "Caudal", unidad: "m³/h", dec: 1 },
  { id: "ec", nombre: "Conductividad de retorno", corto: "Conductividad", unidad: "µS/cm", dec: 0 },
  { id: "a", nombre: "Agua acumulada", corto: "Agua", unidad: "L", dec: 0 },
  { id: "k", nombre: "Químico acumulado", corto: "Químico", unidad: "L", dec: 1 },
];
export const variable = (id: VarId) => VARIABLES.find((v) => v.id === id)!;
export const VARIABLES_DEFECTO: VarId[] = ["T", "c", "q"];

export type Rango = { min?: number; max?: number };
/** Rango válido de una variable en una fase. null: la fase no le exige nada. */
export function rangoFase(f: FaseCiclo, v: VarId): Rango | null {
  if (v === "T") return f.min !== null ? { min: f.min } : null;
  if (v === "c") return f.c > 0.1 ? { min: +(f.c * 0.85).toFixed(3), max: +(f.c * 1.2).toFixed(3) } : null;
  if (v === "q") return f.q >= 10 ? { min: +(f.q * 0.8).toFixed(1) } : null;
  return null;
}
const fuera = (valor: number, r: Rango) => (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
/** Al empezar una fase el circuito aún calienta y se dosifica: todavía no se exige el rango. */
const esperaDe = (f: FaseCiclo) => Math.min(150, f.s * 0.4);

export type NivelConfianza = "alta" | "media" | "baja";
export const nivelConfianza = (pct: number): NivelConfianza => (pct >= 80 ? "alta" : pct >= 55 ? "media" : "baja");
const acotar = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** "≈ 4,5 min", "≈ 12 min" o "menos de 1 min". */
export function enMinutos(s: number): string {
  if (s < 60) return "menos de 1 min";
  return `≈ ${nf(s / 60, s < 600 ? 1 : 0)} min`;
}

/** Recta de mínimos cuadrados y qué tan bien explica los puntos (R²). */
export function regresion(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b, r2: syy > 1e-12 && sxx ? acotar((sxy * sxy) / (sxx * syy), 0, 1) : 0 };
}
const mediana = (v: number[]) => { const o = [...v].sort((a, b) => a - b), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };

export const VARS_CON_RANGO: VarId[] = ["T", "c", "q"];
/** Cuántas lecturas recientes definen la tendencia y hasta dónde se mira adelante. */
export const PUNTOS_TENDENCIA = 5;
export const HORIZONTE_S = 120;
/** Parte del margen que debe haberse consumido para avisar: evita alarmas por el ruido normal. */
export const MARGEN_CONSUMIDO = 0.3;

export type EstadoVar = {
  v: VarId; valor: number; rango: Rango;
  /** ok: en rango · ajustando: la fase recién parte · tiende: en rango, va hacia el límite · fuera: fuera de rango. */
  estado: "ok" | "ajustando" | "tiende" | "fuera";
  lado?: "min" | "max"; limite?: number;
  /** Solo "tiende": segundos de proceso hasta cruzar el límite y confianza de esa tendencia (0-100). */
  enS?: number; confianza?: number;
};

/** Estado de cada variable con rango en la lectura `i` de la curva. */
export function estadosEn(ciclo: Pick<CicloPlanta, "fases" | "curva">, i: number): EstadoVar[] {
  const p = ciclo.curva[i];
  if (!p) return [];
  const fi = faseEn(ciclo.fases, p.t), f = ciclo.fases[fi];
  const inicio = inicioFase(ciclo.fases, fi);
  let j = i;
  while (j > 0 && ciclo.curva[j - 1].t >= inicio) j--;
  const deFase = ciclo.curva.slice(j, i + 1);

  return VARS_CON_RANGO.flatMap((v): EstadoVar[] => {
    const rango = rangoFase(f, v);
    if (!rango) return [];
    const valor = p[v];
    if (fuera(valor, rango)) {
      const lado = rango.min !== undefined && valor < rango.min ? "min" : "max";
      const estuvo = deFase.some((x) => !fuera(x[v], rango));
      return [{ v, valor, rango, lado, limite: rango[lado], estado: !estuvo && p.t - inicio < esperaDe(f) ? "ajustando" : "fuera" }];
    }
    const enRango = deFase.filter((x) => !fuera(x[v], rango));
    const ventana = deFase.slice(-PUNTOS_TENDENCIA);
    if (ventana.length >= 3 && enRango.length >= 3) {
      const { b, r2 } = regresion(ventana.map((x) => x.t), ventana.map((x) => x[v]));
      const ref = mediana(enRango.map((x) => x[v]));
      for (const lado of ["min", "max"] as const) {
        const limite = rango[lado];
        if (limite === undefined) continue;
        const haciaLimite = lado === "min" ? b < 0 : b > 0;
        const margen = Math.abs(ref - limite);
        if (!haciaLimite || margen <= 0) continue;
        const enS = Math.abs(valor - limite) / Math.abs(b);
        const consumido = (lado === "min" ? ref - valor : valor - ref) / margen;
        if (enS <= HORIZONTE_S && consumido >= MARGEN_CONSUMIDO) {
          const confianza = Math.round(acotar(r2 * Math.min(1, ventana.length / 4) * 100, 5, 99));
          return [{ v, valor, rango, estado: "tiende", lado, limite, enS, confianza }];
        }
      }
    }
    return [{ v, valor, rango, estado: "ok" }];
  });
}

export type ProyeccionLimpio =
  | { estado: "limpio"; alS: number }
  | { estado: "reuniendo" }
  | { estado: "proyectando"; restanteS: number; confianza: number; alcanza: boolean; sobraS: number };

export type Proyeccion = {
  fase: string;
  /** Minutos para terminar el ciclo según la receta; la confianza descuenta el riesgo de que una fase se extienda. */
  finCiclo: { restanteS: number; confianza: number };
  /** Solo en enjuagues: cuándo la conductividad de retorno llega al criterio de agua limpia. */
  limpio: ProyeccionLimpio | null;
};

export type Criterio = { ecRed: number; ecLimpio: number };
export const CRITERIO_DEFECTO: Criterio = { ecRed: 150, ecLimpio: 200 };

/** Proyección del ciclo en la lectura `i` (por defecto, la última). */
export function proyectar(
  ciclo: Pick<CicloPlanta, "fases" | "curva" | "prediccion">, i = ciclo.curva.length - 1, cr: Criterio = CRITERIO_DEFECTO,
): Proyeccion | null {
  const p = ciclo.curva[i];
  if (!p) return null;
  const dur = ciclo.fases.reduce((a, f) => a + f.s, 0);
  const fi = faseEn(ciclo.fases, p.t), f = ciclo.fases[fi];
  const inicio = inicioFase(ciclo.fases, fi), dentro = p.t - inicio;

  // Fin del ciclo: lo que falta de receta. Una caída de temperatura en la fase
  // alcalina la extiende, así que antes de superarla la confianza es 1 − riesgo.
  const iSoda = ciclo.fases.findIndex((x) => x.c >= 0.3);
  const enDesvio = estadosEn(ciclo, i).some((e) => e.v === "T" && e.estado === "fuera");
  const riesgo = ciclo.prediccion?.riesgo;
  const confFin = enDesvio ? 55 : iSoda < 0 || fi > iSoda ? 98 : Math.round(acotar((1 - (riesgo ?? 0.1)) * 100, 50, 98));

  let limpio: ProyeccionLimpio | null = null;
  if (f.enjuague && cr.ecLimpio > cr.ecRed) {
    let j = i;
    while (j > 0 && ciclo.curva[j - 1].t >= inicio) j--;
    const deFase = ciclo.curva.slice(j, i + 1);
    const primera = deFase.find((x) => x.ec <= cr.ecLimpio);
    if (primera) limpio = { estado: "limpio", alS: primera.t - inicio };
    else {
      // La conductividad cae como una exponencial hacia la del agua de red: recta en logaritmo
      const utiles = deFase.filter((x) => x.ec - cr.ecRed > 1);
      const { a, b, r2 } = utiles.length >= 4
        ? regresion(utiles.map((x) => x.t - inicio), utiles.map((x) => Math.log(x.ec - cr.ecRed))) : { a: 0, b: 0, r2: 0 };
      if (utiles.length < 4 || b >= 0) limpio = { estado: "reuniendo" };
      else {
        const alS = (Math.log(cr.ecLimpio - cr.ecRed) - a) / b;
        limpio = {
          estado: "proyectando", restanteS: Math.max(0, alS - dentro), alcanza: alS <= f.s, sobraS: f.s - alS,
          confianza: Math.round(acotar(r2 * Math.min(1, utiles.length / 8) * 100, 5, 99)),
        };
      }
    }
  }
  return { fase: f.n, finCiclo: { restanteS: Math.max(0, dur - p.t), confianza: confFin }, limpio };
}

export type AvisoCiclo = { t: number; tono: "warn" | "crit" | "ok"; v: VarId; texto: string };
const ETIQUETA_LADO = { min: ["bajar del mínimo", "bajo el mínimo"], max: ["superar el máximo", "sobre el máximo"] } as const;

/**
 * Bitácora de avisos del ciclo: cuándo una variable empezó a ir hacia su límite,
 * cuándo salió de rango y cuándo volvió. También si el enjuague va a terminar sin
 * llegar a agua limpia. Recorre toda la curva, así sirve en vivo y en ciclos cerrados.
 */
export function avisosCiclo(ciclo: Pick<CicloPlanta, "fases" | "curva" | "prediccion">, cr: Criterio = CRITERIO_DEFECTO): AvisoCiclo[] {
  const out: AvisoCiclo[] = [];
  const previo: Partial<Record<VarId, EstadoVar["estado"]>> = {};
  const ultimoTiende: Partial<Record<VarId, number>> = {};
  let faseAnt = -1, avisoEc = false;
  ciclo.curva.forEach((p, i) => {
    const fi = faseEn(ciclo.fases, p.t);
    if (fi !== faseAnt) { faseAnt = fi; avisoEc = false; for (const v of VARS_CON_RANGO) delete previo[v]; }
    for (const e of estadosEn(ciclo, i)) {
      const antes = previo[e.v] ?? "ok";
      const { corto, unidad, dec } = variable(e.v);
      const lim = e.limite !== undefined ? `${nf(e.limite, dec)} ${unidad}` : "";
      if (e.estado === "tiende" && antes !== "tiende" && antes !== "fuera" && p.t - (ultimoTiende[e.v] ?? -1e9) > 60) {
        ultimoTiende[e.v] = p.t;
        out.push({ t: p.t, tono: "warn", v: e.v, texto: `${corto} tiende a ${ETIQUETA_LADO[e.lado!][0]} (${lim}) en ${enMinutos(e.enS!)} · confianza ${e.confianza} %` });
      } else if (e.estado === "fuera" && antes !== "fuera") {
        out.push({ t: p.t, tono: "crit", v: e.v, texto: `${corto} fuera de rango: ${nf(e.valor, dec)} ${unidad}, ${ETIQUETA_LADO[e.lado!][1]} de ${lim}` });
      } else if (e.estado !== "fuera" && e.estado !== "ajustando" && antes === "fuera") {
        out.push({ t: p.t, tono: "ok", v: e.v, texto: `${corto} volvió a su rango: ${nf(e.valor, dec)} ${unidad}` });
      }
      previo[e.v] = e.estado;
    }
    if (!avisoEc && ciclo.fases[fi].enjuague) {
      const l = proyectar(ciclo, i, cr)?.limpio;
      if (l?.estado === "proyectando" && !l.alcanza && l.confianza >= 55) {
        avisoEc = true;
        out.push({ t: p.t, tono: "warn", v: "ec", texto: `Conductividad: el ${ciclo.fases[fi].n.toLowerCase()} terminaría sin llegar a agua limpia (faltarían ${mmss(-l.sobraS)}) · confianza ${l.confianza} %` });
      }
    }
  });
  return out;
}

/** Un ciclo dentro del eje compartido del gráfico de periodo. */
export type Segmento = {
  ciclo: CicloPlanta;
  /** Posición en el eje: segundos acumulados de todos los ciclos anteriores, más las separaciones. */
  x0: number; x1: number;
  puntos: PuntoCurva[];
};

/**
 * Pone un ciclo tras otro, en orden de inicio, sobre un solo eje. Entre dos ciclos pasan
 * horas sin lecturas: dibujarlas a escala dejaría cada ciclo como una raya, así que el
 * eje solo cuenta el tiempo dentro de los ciclos y los separa con un espacio fijo.
 * Con muchos ciclos reduce los puntos de cada uno para no pasar de `maxPuntos`.
 */
export function segmentosPeriodo(ciclos: CicloPlanta[], maxPuntos = 6000): { segmentos: Segmento[]; total: number } {
  const orden = ciclos.filter((c) => c.curva?.length > 1 && c.fases?.length)
    .sort((a, b) => (fechaDe(a.inicio)?.getTime() ?? 0) - (fechaDe(b.inicio)?.getTime() ?? 0));
  const durDe = (c: CicloPlanta) => c.fases.reduce((a, f) => a + f.s, 0);
  const suma = orden.reduce((a, c) => a + durDe(c), 0);
  const sep = orden.length > 1 ? (suma * 0.04) / (orden.length - 1) : 0;
  const puntosTotales = orden.reduce((a, c) => a + c.curva.length, 0);
  const paso = Math.max(1, Math.ceil(puntosTotales / maxPuntos));
  let x = 0;
  const segmentos = orden.map((ciclo) => {
    const x0 = x, x1 = x + durDe(ciclo);
    x = x1 + sep;
    const ult = ciclo.curva.length - 1;
    return { ciclo, x0, x1, puntos: paso === 1 ? ciclo.curva : ciclo.curva.filter((_, k) => k % paso === 0 || k === ult) };
  });
  return { segmentos, total: Math.max(1, x - sep) };
}
