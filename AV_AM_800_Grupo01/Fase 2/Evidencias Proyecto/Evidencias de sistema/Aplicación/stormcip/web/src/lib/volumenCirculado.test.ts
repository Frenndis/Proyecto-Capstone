import { describe, expect, it } from "vitest";
import {
  ETIQUETA_DESINFECCION, EstadoVolumen, estadoVolumen, formatearLitros, formatearM3, formatearUso,
} from "./volumenCirculado";

type Ciclo = NonNullable<Parameters<typeof estadoVolumen>[0]>;

const consumos = { aguaTotal: 0.612, aguaRecuperada: 0.187, soda: 150, acido: 150 };
// Ciclo de 300 s de la demo: circulado por etapa tal como lo integra el trigger
const CIRCULADO = {
  preenjuague: 181.4, alcalino: 331.8, enjuague: 181.8, acido: 282.1, enjuague_final: 281.8, desinfeccion: 136.7,
};
const ciclo = (litros: Record<string, number>, extra: Partial<Ciclo> = {}): Ciclo => ({
  estado: "finalizado", etapaActual: "desinfeccion", consumos,
  volumenCirculado: { litros }, ...extra,
});
const listo = (e: EstadoVolumen) => {
  if (e.tipo !== "listo") throw new Error(`debía estar listo, está ${e.tipo}`);
  return e;
};
const fila = (e: EstadoVolumen, etapa: string) => {
  const f = listo(e).filas.find((x) => x.etapa === etapa);
  if (!f) throw new Error(`falta la fila ${etapa}`);
  return f;
};

describe("estadoVolumen: estados sin datos", () => {
  it("sin volumenCirculado y sin caudal: 'sin caudal', nunca 0 L", () => {
    expect(estadoVolumen(undefined, undefined, true)).toEqual({ tipo: "sin_caudal" });
    expect(estadoVolumen(undefined, undefined, false)).toEqual({ tipo: "sin_caudal" });
  });

  it("ciclo cerrado sin volumen (anterior a esta función): sin caudal aunque haya caudal de planta", () => {
    expect(estadoVolumen(undefined, 18, false)).toEqual({ tipo: "sin_caudal" });
    expect(estadoVolumen({ estado: "finalizado", etapaActual: "x", consumos }, 18, false)).toEqual({ tipo: "sin_caudal" });
  });

  it("ciclo en curso con caudal pero sin suma todavía: acumulando", () => {
    expect(estadoVolumen(undefined, 18, true)).toEqual({ tipo: "acumulando" });
    expect(estadoVolumen(ciclo({}, { estado: "en_curso" }), 18, true)).toEqual({ tipo: "acumulando" });
  });

  it("un caudal de 0 m³/h es un caudal informado: acumulando, no 'sin caudal'", () => {
    expect(estadoVolumen(undefined, 0, true)).toEqual({ tipo: "acumulando" });
  });
});

describe("estadoVolumen: ciclo finalizado completo", () => {
  const e = estadoVolumen(ciclo(CIRCULADO), 0, false);

  it("filas en el orden del ciclo", () => {
    expect(listo(e).filas.map((f) => f.etapa))
      .toEqual(["preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion"]);
  });

  it("el agua sale del circulado de la etapa y no es estimada", () => {
    for (const [etapa, litros] of [["preenjuague", 181.4], ["enjuague", 181.8], ["enjuague_final", 281.8], ["desinfeccion", 136.7]] as const) {
      expect(fila(e, etapa)).toMatchObject({ tipo: "agua", litros, estimado: false, recirculadoL: null });
    }
  });

  it("soda y ácido salen de consumos (retención), estimados, con el recirculado aparte", () => {
    expect(fila(e, "alcalino")).toMatchObject({ tipo: "quimico", fuente: "soda", litros: 150, estimado: true, recirculadoL: 331.8 });
    expect(fila(e, "acido")).toMatchObject({ tipo: "quimico", fuente: "acido", litros: 150, estimado: true, recirculadoL: 282.1 });
  });

  it("el recirculado de soda y ácido NO entra en ningún total", () => {
    const t = listo(e).totales;
    expect(t.sodaL).toBe(150);
    expect(t.acidoL).toBe(150);
    expect(t.aguaRedL).toBeCloseTo(181.8 + 281.8 + 136.7, 10);
  });

  it("el total de agua de red es la suma de sus filas y la recuperada va separada, sin duplicarse", () => {
    const t = listo(e).totales;
    expect(t.aguaRedL).toBeCloseTo(600.3, 10);       // 0,6003 m³: ~2 % bajo consumos.aguaTotal (0,612)
    expect(t.aguaRecuperadaL).toBeCloseTo(181.4, 10); // solo el preenjuague
    // aguaTotal del backend no se usa: el total sale de las filas
    expect(t.aguaRedL).not.toBeCloseTo(consumos.aguaTotal * 1000, 0);
  });

  it("la desinfección se rotula como agua con sanitizante, con el sanitizante sin dato", () => {
    expect(fila(e, "desinfeccion")).toMatchObject({
      label: ETIQUETA_DESINFECCION, fuente: "red", sanitizanteSinDato: true,
    });
    expect(ETIQUETA_DESINFECCION).toBe("Desinfección (agua con sanitizante 0,15 %)");
    expect(fila(e, "enjuague").sanitizanteSinDato).toBe(false);
  });

  it("enjuagues en azul (monitoreada) y etapas químicas en ámbar", () => {
    expect(Object.fromEntries(listo(e).filas.map((f) => [f.etapa, f.monitoreada])))
      .toEqual({ preenjuague: true, alcalino: false, enjuague: true, acido: false, enjuague_final: true, desinfeccion: false });
  });
});

describe("estadoVolumen: ciclo en curso", () => {
  it("la etapa que no corrió queda sin valor, no en 0", () => {
    const e = estadoVolumen(ciclo({ preenjuague: 181.4 }, { estado: "en_curso", etapaActual: "preenjuague", consumos: { ...consumos, soda: 0, acido: 0 } }), 18, true);
    expect(listo(e).filas.map((f) => f.litros)).toEqual([181.4, null, null, null, null]);
    expect(fila(e, "preenjuague").enCurso).toBe(true);
    expect(listo(e).totales).toMatchObject({ aguaRedL: null, sodaL: null, acidoL: null });
  });

  it("mientras corre el alcalino consumos.soda vale 0 pero NO se muestra: la etapa no terminó", () => {
    const e = estadoVolumen(ciclo({ preenjuague: 181.4, alcalino: 100 }, {
      estado: "en_curso", etapaActual: "alcalino", consumos: { ...consumos, soda: 0, acido: 0 },
    }), 18, true);
    expect(fila(e, "alcalino")).toMatchObject({ litros: null, enCurso: true, recirculadoL: 100 });
    expect(listo(e).totales.sodaL).toBeNull();
  });

  it("al pasar al enjuague el alcalino ya terminó y muestra su consumo", () => {
    const e = estadoVolumen(ciclo({ preenjuague: 181.4, alcalino: 331.8, enjuague: 20 }, {
      estado: "en_curso", etapaActual: "enjuague", consumos: { ...consumos, acido: 0 },
    }), 18, true);
    expect(fila(e, "alcalino")).toMatchObject({ litros: 150, enCurso: false });
    expect(fila(e, "acido").litros).toBeNull();
  });

  it("el agua en curso muestra lo acumulado hasta ahora", () => {
    const e = estadoVolumen(ciclo({ preenjuague: 90 }, { estado: "en_curso", etapaActual: "preenjuague" }), 18, true);
    expect(fila(e, "preenjuague")).toMatchObject({ litros: 90, enCurso: true });
  });
});

describe("estadoVolumen: casos límite", () => {
  it("sin consumos en el ciclo: soda y ácido 'sin dato', el agua sigue", () => {
    const e = estadoVolumen(ciclo(CIRCULADO, { consumos: undefined }), 0, false);
    expect(fila(e, "alcalino").litros).toBeNull();
    expect(fila(e, "alcalino").recirculadoL).toBe(331.8);
    expect(fila(e, "enjuague").litros).toBe(181.8);
    expect(listo(e).totales.sodaL).toBeNull();
  });

  it("ciclo abortado: las etapas con dato muestran su consumo", () => {
    const e = estadoVolumen(ciclo({ preenjuague: 100, alcalino: 40 }, {
      estado: "abortado", etapaActual: "alcalino", consumos: { ...consumos, soda: 40, acido: 0 },
    }), 0, false);
    expect(fila(e, "alcalino")).toMatchObject({ litros: 40, enCurso: false });
  });

  it("la desinfección sin volumen no aparece", () => {
    const e = estadoVolumen(ciclo({ ...CIRCULADO, desinfeccion: 0 }), 0, false);
    expect(listo(e).filas.some((f) => f.etapa === "desinfeccion")).toBe(false);
  });

  it("lleva la marca de simulado y los huecos", () => {
    const c = ciclo(CIRCULADO);
    c.volumenCirculado = { litros: CIRCULADO, simulado: true, huecos: 3 };
    expect(estadoVolumen(c, 0, false)).toMatchObject({ tipo: "listo", simulado: true, huecos: 3 });
    expect(estadoVolumen(ciclo(CIRCULADO), 0, false)).toMatchObject({ simulado: false, huecos: 0 });
  });
});

describe("formateo", () => {
  it("formatearLitros: enteros con separador de miles", () => {
    expect(formatearLitros(1395.6)).toBe("1.396 L");
    expect(formatearLitros(150)).toBe("150 L");
  });

  it("formatearM3: 3 decimales bajo 10 m³ y litros entre paréntesis bajo 1 m³", () => {
    expect(formatearM3(187)).toBe("0,187 m³ (187 L)");
    expect(formatearM3(600.3)).toBe("0,600 m³ (600 L)");
    expect(formatearM3(1250)).toBe("1,250 m³");
    expect(formatearM3(9999)).toBe("9,999 m³");
  });

  it("formatearM3: desde 10 m³ usa 2 decimales", () => {
    expect(formatearM3(10000)).toBe("10,00 m³");
    expect(formatearM3(18432)).toBe("18,43 m³");
  });

  it("sin valor muestra una raya, no 0", () => {
    expect(formatearM3(null)).toBe("—");
    expect(formatearLitros(null)).toBe("—");
  });

  it("formatearUso: agua en m³, soluciones químicas en litros", () => {
    expect(formatearUso({ tipo: "agua", litros: 187 })).toBe("0,187 m³ (187 L)");
    expect(formatearUso({ tipo: "quimico", litros: 150 })).toBe("150 L");
  });
});
