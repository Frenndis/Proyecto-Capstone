import { describe, expect, it } from "vitest";
import {
  ModeloPrograma, aguaPorDia, ahorroTotalPorCiclo, ciclosDelDia, consumoPorPrograma, duracionMin,
  estadoDeCiclo, formatoTiempo, resumenDe,
} from "./central";
import { Ciclo } from "./tipos";

const ts = (d: Date) => ({ toDate: () => d });
const HOY = new Date(2026, 10, 2, 12);
const ciclo = (p: Partial<Ciclo>) => ({
  id: "x", estado: "finalizado", programa: "P", inicio: ts(HOY),
  consumos: { aguaTotal: 1, aguaRecuperada: 0.5, soda: 10, acido: 5 },
  indicadoresCalculadosEn: ts(HOY), indicadores: { tiempoHastaLimpio: 30 }, ...p,
} as Ciclo);

describe("estadoDeCiclo", () => {
  it("distingue cada estado sin dar por limpio lo que no se sabe", () => {
    expect(estadoDeCiclo(ciclo({ estado: "en_curso" })).texto).toBe("En curso");
    expect(estadoDeCiclo(ciclo({ estado: "abortado" })).texto).toBe("Abortado");
    expect(estadoDeCiclo(ciclo({ indicadoresCalculadosEn: null })).texto).toBe("Calculando");
    expect(estadoDeCiclo(ciclo({})).tono).toBe("ok");
    expect(estadoDeCiclo(ciclo({ indicadores: {} })).tono).toBe("crit");
  });
});

describe("resumenDe", () => {
  it("cuenta por estado y suma el agua", () => {
    expect(resumenDe([ciclo({}), ciclo({ indicadores: {} }), ciclo({ estado: "en_curso", consumos: undefined })]))
      .toEqual({ total: 3, enCurso: 1, limpios: 1, sinLimpiar: 1, aguaM3: 2 });
  });
});

describe("ciclosDelDia", () => {
  it("usa el día local e ignora ciclos sin fecha", () => {
    const ayer = ciclo({ inicio: ts(new Date(2026, 10, 1, 23)) });
    expect(ciclosDelDia([ciclo({}), ayer, ciclo({ inicio: null })], HOY)).toHaveLength(1);
  });
});

describe("duracionMin", () => {
  it("es null mientras no termina", () => {
    expect(duracionMin(ciclo({}))).toBeNull();
    expect(duracionMin(ciclo({ fin: ts(new Date(HOY.getTime() + 300000)) }))).toBe(5);
  });
});

describe("consumoPorPrograma", () => {
  it("agrupa solo ciclos cerrados y ordena por agua", () => {
    const filas = consumoPorPrograma([
      ciclo({ programa: "A" }), ciclo({ programa: "B" }), ciclo({ programa: "B" }), ciclo({ programa: "C", estado: "en_curso" }),
    ]);
    expect(filas.map((f) => f.clave)).toEqual(["B", "A"]);
    expect(filas[0]).toMatchObject({ ciclos: 2, aguaM3: 2, sodaL: 20, acidoL: 10 });
  });
});

describe("aguaPorDia", () => {
  it("incluye los días sin ciclos y termina hoy", () => {
    const d = aguaPorDia([ciclo({})], HOY, 3);
    expect(d.map((p) => p.ciclos)).toEqual([0, 0, 1]);
    expect(d[2].aguaM3).toBe(1);
  });
});

describe("formatoTiempo", () => {
  it("usa segundos cortos y minutos con coma", () => {
    expect(formatoTiempo(45)).toBe("45 s");
    expect(formatoTiempo(1200)).toBe("20,0 min");
  });
});

describe("ahorroTotalPorCiclo", () => {
  it("suma solo las etapas con sugerencia", () => {
    const m = { etapas: {
      a: { estado: "sugerencia", ahorroAguaL: 100 }, b: { estado: "sin_ahorro" }, c: { estado: "sugerencia", ahorroAguaL: 50 },
    } } as unknown as ModeloPrograma;
    expect(ahorroTotalPorCiclo(m)).toBe(150);
  });
});
