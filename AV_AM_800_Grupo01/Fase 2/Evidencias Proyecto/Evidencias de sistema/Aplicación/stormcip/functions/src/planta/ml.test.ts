import { describe, expect, it } from "vitest";
import { CIRCUITOS, contextoPara, litrosPorSDe, probDesvio, resumir, rng } from "./motor";
import {
  CONFIG_ML, CicloML, ajustarLineal, ajustarLogistica, analizar, auc, entrenarModelos, entrenarRegresor, medirClasificacion, medirRegresion,
} from "./ml";

const DIA = 86400000;
const AHORA = Date.UTC(2026, 10, 2, 15);

/** 60 días de la planta, con las mismas causas que usa la siembra. */
function historia(dias = 120): CicloML[] {
  const out: CicloML[] = [];
  for (let d = dias; d > 0; d--) {
    for (const c of CIRCUITOS) {
      const semilla = d * 100 + CIRCUITOS.indexOf(c);
      const ctx = contextoPara(c, new Date(AHORA - d * DIA), semilla);
      const desvio = rng(semilla + 9)() < probDesvio(c, ctx);
      out.push({
        circuitoId: c.id, circuito: c.nombre, inicioMs: AHORA - d * DIA, litrosPorS: litrosPorSDe(c), contexto: ctx,
        resumen: resumir(c, { semilla, desvio, contexto: ctx }),
      });
    }
  }
  return out;
}

const h = historia();
const modelos = entrenarModelos(h);
const m = (id: string) => modelos.metricas.find((x) => x.id === id)!;

describe("modelos entrenados", () => {
  it("entrena los cinco modelos", () => {
    expect(modelos.metricas.map((x) => x.id)).toEqual(["limpio", "limpioVivo", "agua", "quimico", "riesgo"]);
  });

  it("prueba solo con ciclos posteriores a los de entrenamiento", () => {
    expect(m("agua").filasPrueba).toBe(Math.ceil(m("agua").filas * CONFIG_ML.fraccionPrueba));
  });

  it.each(["limpio", "limpioVivo", "agua", "quimico"])("%s le gana al promedio en ciclos que no vio", (id) => {
    const x = m(id);
    expect(x.error).toBeLessThan(x.errorBase);
    expect(x.util).toBe(true);
    expect(x.r2).toBeGreaterThan(0);
  });

  it("predecir durante el enjuague es mejor que antes de empezar", () => {
    expect(m("limpioVivo").error).toBeLessThan(m("limpio").error);
  });

  it("el riesgo de desvío reporta su medición, gane o no", () => {
    const x = m("riesgo");
    expect(x.error).toBeGreaterThanOrEqual(0);
    expect(x.errorBase).toBeGreaterThan(0);
    expect(typeof x.util).toBe("boolean");
  });

  it("el margen cubre la mayoría de los ciclos que no vio", () => {
    expect(m("limpio").cobertura!).toBeGreaterThan(0.75);
    expect(m("agua").cobertura!).toBeGreaterThan(0.75);
  });

  it("nombra lo que más influye, y aprende la causa real", () => {
    const f = m("limpio").factores;
    expect(f[0].peso).toBeGreaterThan(0);
    expect(f.map((x) => x.n)).toContain("Carga de producto");
  });

  it("más carga de producto predice más tiempo de enjuague", () => {
    const c = CIRCUITOS.find((x) => x.id === "silo3")!;
    const ctx = contextoPara(c, new Date(AHORA), 5);
    const poca = modelos.predecirCiclo("silo3", { ...ctx, carga: 0.7 })!;
    const mucha = modelos.predecirCiclo("silo3", { ...ctx, carga: 1.4 })!;
    expect(mucha.limpio["Enjuague final"].s).toBeGreaterThan(poca.limpio["Enjuague final"].s);
    expect(mucha.quimicoL).toBeGreaterThan(poca.quimicoL);
  });

  it("la predicción en vivo usa la conductividad medida", () => {
    const c = CIRCUITOS.find((x) => x.id === "silo3")!;
    const ctx = contextoPara(c, new Date(AHORA), 5);
    const lento = modelos.predecirEnVivo("silo3", "Enjuague final", 300, 1500, ctx)!;
    const rapido = modelos.predecirEnVivo("silo3", "Enjuague final", 300, 500, ctx)!;
    expect(lento.s).toBeGreaterThan(rapido.s);
  });
});

describe("métricas de calidad publicadas", () => {
  it.each(["limpio", "limpioVivo", "agua", "quimico"])("%s publica MAE, RMSE, R² y real contra predicho", (id) => {
    const x = m(id);
    expect(x.tipo).toBe("regresion");
    expect(x.rmse!).toBeGreaterThanOrEqual(x.error);
    expect(x.r2!).toBeLessThanOrEqual(1);
    expect(x.errorEntrenamiento).toBeGreaterThan(0);
    expect(x.puntos.length).toBeGreaterThan(0);
    expect(x.puntos.length).toBeLessThanOrEqual(Math.min(x.filasPrueba, 120));
    expect(x.clasificacion).toBeNull();
  });

  it.each(["limpio", "limpioVivo", "agua", "quimico"])("%s se compara con regresión lineal en la misma prueba", (id) => {
    const l = m(id).lineal!;
    expect(l.modelo).toBe("Regresión lineal");
    expect(l.error).toBeGreaterThan(0);
    expect(l.rmse!).toBeGreaterThanOrEqual(l.error);
    expect(l.mejora).toBeCloseTo(1 - l.error / m(id).errorBase, 2);
  });

  it("el riesgo publica su matriz de confusión sobre todos los ciclos de prueba", () => {
    const x = m("riesgo"), c = x.clasificacion!;
    expect(x.tipo).toBe("clasificacion");
    expect(c.vp + c.fp + c.vn + c.fn).toBe(x.filasPrueba);
    expect(c.acierto).toBeCloseTo((c.vp + c.vn) / x.filasPrueba, 3);
    expect(c.umbral).toBe(CONFIG_ML.umbralRiesgo);
    expect(c.auc!).toBeGreaterThan(0.5);
    expect(x.lineal!.modelo).toBe("Regresión logística");
    expect(x.r2).toBeNull();
  });
});

describe("cálculo de las métricas", () => {
  it("MAE, RMSE y R² con valores conocidos", () => {
    const r = medirRegresion([1, 2, 3, 4], [1, 2, 3, 6]);
    expect(r.mae).toBeCloseTo(0.5);
    expect(r.rmse).toBeCloseTo(1);
    expect(r.r2).toBeCloseTo(1 - 4 / 5);
    expect(medirRegresion([1, 2, 3], [1, 2, 3]).r2).toBeCloseTo(1);
  });

  it("matriz de confusión, precisión, recall y F1", () => {
    // reales:   1    1    1    0    0    0    0
    // predice:  1    1    0    1    0    0    0
    const c = medirClasificacion([0.9, 0.7, 0.2, 0.6, 0.1, 0.3, 0.4], [1, 1, 1, 0, 0, 0, 0], 0.5);
    expect([c.vp, c.fn, c.fp, c.vn]).toEqual([2, 1, 1, 3]);
    expect(c.acierto).toBeCloseTo(5 / 7, 3);
    expect(c.precision).toBeCloseTo(2 / 3, 3);
    expect(c.recall).toBeCloseTo(2 / 3, 3);
    expect(c.f1).toBeCloseTo(2 / 3, 3);
  });

  it("sin desvíos anunciados, la precisión no se inventa", () => {
    const c = medirClasificacion([0.1, 0.2], [1, 0], 0.5);
    expect(c.precision).toBeNull();
    expect(c.recall).toBe(0);
  });

  it("AUC: 1 si ordena perfecto, 0 si al revés, 0,5 si no distingue", () => {
    expect(auc([0.9, 0.8, 0.1], [1, 1, 0])).toBe(1);
    expect(auc([0.1, 0.9], [1, 0])).toBe(0);
    expect(auc([0.5, 0.5], [1, 0])).toBe(0.5);
    expect(auc([0.5, 0.5], [0, 0])).toBeNull();
  });

  it("la regresión lineal recupera una relación lineal con una categoría", () => {
    const r = rng(7);
    const xs = Array.from({ length: 200 }, () => [Math.floor(r() * 3), r() * 10, r() * 5]);
    const y = (x: number[]) => [0, 50, -20][x[0]] + 3 * x[1] - 2 * x[2] + 7;
    const f = ajustarLineal(xs, xs.map(y), [0]);
    for (const x of [[0, 1, 1], [1, 5, 2], [2, 9, 4]]) expect(f(x)).toBeCloseTo(y(x), 0);
  });

  it("la regresión logística separa dos grupos", () => {
    const r = rng(11);
    const xs = Array.from({ length: 300 }, () => [r() * 10]);
    const ys = xs.map((x) => (x[0] + (r() - 0.5) * 2 > 5 ? 1 : 0));
    const f = ajustarLogistica(xs, ys);
    expect(f([9])).toBeGreaterThan(0.9);
    expect(f([1])).toBeLessThan(0.1);
  });
});

describe("cuando no hay nada que aprender", () => {
  it("con datos al azar no se declara útil", () => {
    const r = rng(3);
    const filas = Array.from({ length: 200 }, (_, i) => ({
      x: [r(), r(), r()], y: r() * 100, base: "a", t: i,
    }));
    expect(entrenarRegresor("x", "x", "s", filas, ["a", "b", "c"])!.metrica.util).toBe(false);
  });

  it("con pocos datos no entrena", () => {
    expect(entrenarRegresor("x", "x", "s", [], [])).toBeNull();
    expect(entrenarModelos(historia(3)).metricas).toEqual([]);
  });
});

describe("analizar", () => {
  const a = analizar(h, AHORA);

  it("publica métricas y predicción por circuito", () => {
    expect(a.ml.algoritmo).toBe("Random Forest");
    const p = a.predicciones.find((x) => x.circuitoId === "silo3")!;
    expect(p.ml!.aguaL).toBeGreaterThan(4500);
    expect(p.ml!.riesgo).toBeGreaterThanOrEqual(0);
    expect(p.ml!.riesgo).toBeLessThanOrEqual(1);
    expect(p.ml!.limpio["Enjuague final"].s).toBeGreaterThan(0);
  });

  it("el tiempo sugerido sigue cubriendo al menos el 95 % de los ciclos reales", () => {
    for (const d of a.decisiones.filter((x) => x.tipo === "acortar_enjuague")) {
      const reales = h.filter((c) => c.circuitoId === d.circuitoId).map((c) => c.resumen.fases.find((f) => f.n === d.fase)!.limpioS!).filter((t) => t !== null);
      expect(reales.filter((t) => t <= d.sugeridoS!).length / reales.length).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("no deja valores que Firestore rechazaría", () => {
    expect(JSON.stringify(a)).not.toContain("NaN");
    const revisar = (v: unknown): void => {
      if (v === undefined) throw new Error("undefined");
      if (v && typeof v === "object") Object.values(v).forEach(revisar);
    };
    revisar(a);
  });
});
