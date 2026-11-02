import { describe, expect, it } from "vitest";
import { CIRCUITOS, contextoPara, litrosPorSDe, probDesvio, resumir, rng } from "./motor";
import { CONFIG_ML, CicloML, analizar, entrenarModelos, entrenarRegresor } from "./ml";

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
