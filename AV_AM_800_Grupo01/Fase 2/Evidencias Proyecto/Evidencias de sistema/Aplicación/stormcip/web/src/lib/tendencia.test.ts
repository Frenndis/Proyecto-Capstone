import { describe, expect, it } from "vitest";
import { CicloPlanta, FaseCiclo, PuntoCurva } from "./planta";
import {
  avisosCiclo, enMinutos, estadosEn, nivelConfianza, proyectar, rangoFase, regresion, segmentosPeriodo,
} from "./tendencia";

const fase = (n: string, s: number, t: number, c = 0, min: number | null = null): FaseCiclo =>
  ({ n, etapa: "x", s, sReceta: s, t, c, q: 26, min, enjuague: n.startsWith("Enjuague") });
const FASES = [fase("Preenjuague", 200, 35), fase("Soda", 400, 70, 1.3, 65), fase("Enjuague final", 200, 30)];

/** Curva cada 5 s. `T` y `ec` reciben el tiempo del ciclo. */
function curva(T: (t: number) => number, ec: (dentro: number) => number = (d) => 150 + 2000 * Math.exp(-d / 40), hasta = 800): PuntoCurva[] {
  const out: PuntoCurva[] = [];
  for (let t = 0; t <= hasta; t += 5) {
    const enSoda = t >= 200 && t < 600;
    out.push({ t, T: T(t), c: enSoda ? 1.3 : 0, q: 26, ec: t >= 600 ? ec(t - 600) : 500, a: t, k: 0 });
  }
  return out;
}
const estable = (t: number) => (t >= 200 && t < 600 ? 70 - 35 * Math.exp(-(t - 200) / 20) : 35);
/** Cae 9 °C en forma de seno entre t=400 y t=470, como el desvío del simulador. */
const conCaida = (t: number) => estable(t) - (t > 400 && t < 470 ? 9 * Math.sin(((t - 400) / 70) * Math.PI) : 0);
const ciclo = (c: PuntoCurva[], extra: Partial<CicloPlanta> = {}) => ({ fases: FASES, curva: c, ...extra }) as CicloPlanta;
const idx = (c: PuntoCurva[], t: number) => c.findIndex((p) => p.t === t);

describe("rangoFase", () => {
  it("da los límites de cada variable según la fase", () => {
    expect(rangoFase(FASES[1], "T")).toEqual({ min: 65 });
    expect(rangoFase(FASES[1], "c")).toEqual({ min: 1.105, max: 1.56 });
    expect(rangoFase(FASES[1], "q")).toEqual({ min: 20.8 });
    expect(rangoFase(FASES[0], "T")).toBeNull();
    expect(rangoFase(FASES[0], "c")).toBeNull();
    expect(rangoFase(FASES[1], "ec")).toBeNull();
  });
});

describe("estadosEn", () => {
  const c = curva(conCaida);
  const T = (t: number) => estadosEn(ciclo(c), idx(c, t)).find((e) => e.v === "T")!;

  it("mientras la fase calienta no exige el rango", () => {
    expect(T(205).estado).toBe("ajustando");
  });
  it("estable y lejos del límite: ok", () => {
    expect(T(390).estado).toBe("ok");
  });
  it("avisa que tiende a salir ANTES de cruzar el mínimo", () => {
    const e = T(410);
    expect(e.valor).toBeGreaterThan(65);
    expect(e).toMatchObject({ estado: "tiende", lado: "min", limite: 65 });
    expect(e.enS).toBeGreaterThan(0);
    expect(e.enS).toBeLessThan(60);
    expect(e.confianza).toBeGreaterThan(50);
  });
  it("bajo el mínimo: fuera; y al recuperarse vuelve a ok", () => {
    expect(T(435).estado).toBe("fuera");
    expect(T(500).estado).toBe("ok");
  });
  it("el ruido normal de la medición no dispara avisos", () => {
    const ruido = curva((t) => estable(t) + Math.sin(t / 7) * 0.35);
    const estados = ruido.map((_, i) => estadosEn(ciclo(ruido), i).find((e) => e.v === "T")?.estado);
    expect(estados).not.toContain("tiende");
    expect(estados).not.toContain("fuera");
  });
});

describe("proyectar", () => {
  it("fin del ciclo: lo que falta de receta, con confianza 1 − riesgo antes de pasar la soda", () => {
    const c = curva(estable);
    const p = proyectar(ciclo(c, { prediccion: { riesgo: 0.2 } as never }), idx(c, 300))!;
    expect(p.finCiclo).toEqual({ restanteS: 500, confianza: 80 });
    expect(p.limpio).toBeNull();
    expect(proyectar(ciclo(c), idx(c, 650))!.finCiclo.confianza).toBe(98);
  });
  it("con la temperatura fuera de rango, la confianza del fin del ciclo baja", () => {
    const c = curva(conCaida);
    expect(proyectar(ciclo(c), idx(c, 435))!.finCiclo.confianza).toBe(55);
  });
  it("en el enjuague proyecta cuándo llega a agua limpia y gana confianza con más lecturas", () => {
    const c = curva(estable);
    // 150 + 2000·e^(−d/40) = 200 → d = 40·ln(40) ≈ 147,6 s
    const pocas = proyectar(ciclo(c), idx(c, 615))!.limpio!;
    const muchas = proyectar(ciclo(c), idx(c, 650))!.limpio!;
    expect(pocas.estado).toBe("proyectando");
    if (pocas.estado !== "proyectando" || muchas.estado !== "proyectando") throw new Error("sin proyección");
    expect(muchas.restanteS).toBeCloseTo(147.6 - 50, 0);
    expect(muchas.alcanza).toBe(true);
    expect(muchas.confianza).toBeGreaterThan(pocas.confianza);
    expect(muchas.confianza).toBeGreaterThanOrEqual(95);
  });
  it("con menos de 4 lecturas del enjuague todavía reúne datos", () => {
    const c = curva(estable);
    expect(proyectar(ciclo(c), idx(c, 610))!.limpio).toEqual({ estado: "reuniendo" });
  });
  it("cuando ya cumple el criterio informa desde cuándo", () => {
    const c = curva(estable);
    expect(proyectar(ciclo(c), idx(c, 790))!.limpio).toEqual({ estado: "limpio", alS: 150 });
  });
  it("si la caída es muy lenta, dice que no alcanza dentro de la fase", () => {
    const c = curva(estable, (d) => 150 + 2000 * Math.exp(-d / 90));
    const l = proyectar(ciclo(c), idx(c, 660))!.limpio!;
    expect(l).toMatchObject({ estado: "proyectando", alcanza: false });
  });
});

describe("avisosCiclo", () => {
  it("deja la secuencia tiende → fuera → volvió, una vez cada uno", () => {
    const a = avisosCiclo(ciclo(curva(conCaida))).filter((x) => x.v === "T");
    expect(a.map((x) => x.tono)).toEqual(["warn", "crit", "ok"]);
    expect(a[0].texto).toMatch(/tiende a bajar del mínimo \(65,0 °C\).*confianza \d+ %/);
    expect(a[0].t).toBeLessThan(a[1].t);
  });
  it("un ciclo normal no deja avisos", () => {
    expect(avisosCiclo(ciclo(curva(estable)))).toEqual([]);
  });
  it("avisa una vez si el enjuague no va a llegar a agua limpia", () => {
    const a = avisosCiclo(ciclo(curva(estable, (d) => 150 + 2000 * Math.exp(-d / 90))));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ v: "ec", tono: "warn" });
  });
});

describe("apoyo", () => {
  it("regresion recupera la recta", () => {
    const r = regresion([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(r.a).toBeCloseTo(1); expect(r.b).toBeCloseTo(2); expect(r.r2).toBeCloseTo(1);
  });
  it("enMinutos y nivelConfianza", () => {
    expect(enMinutos(40)).toBe("menos de 1 min");
    expect(enMinutos(270)).toBe("≈ 4,5 min");
    expect(enMinutos(900)).toBe("≈ 15 min");
    expect([90, 60, 30].map(nivelConfianza)).toEqual(["alta", "media", "baja"]);
  });
  it("segmentosPeriodo ordena por inicio, separa los ciclos y reduce puntos", () => {
    const en = (ms: number) => ({ toDate: () => new Date(ms) }) as never;
    const a = { ...ciclo(curva(estable)), id: "a", inicio: en(2000) }, b = { ...ciclo(curva(estable)), id: "b", inicio: en(1000) };
    const { segmentos, total } = segmentosPeriodo([a, b], 100);
    expect(segmentos.map((s) => s.ciclo.id)).toEqual(["b", "a"]);
    expect(segmentos[0]).toMatchObject({ x0: 0, x1: 800 });
    expect(segmentos[1].x0).toBeGreaterThan(800);
    expect(total).toBe(segmentos[1].x1);
    expect(segmentos[0].puntos.length).toBeLessThanOrEqual(55);
    expect(segmentos[0].puntos.at(-1)!.t).toBe(800);
  });
});
