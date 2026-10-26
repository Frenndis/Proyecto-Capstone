import { describe, expect, it } from "vitest";
import { estadoVolumen, formatearLitros } from "./volumenCirculado";

const vc = (litros: Record<string, number>, extra = {}) => ({ litros, ...extra });

describe("estadoVolumen", () => {
  it("sin volumenCirculado y sin caudal: 'sin caudal', nunca 0 L", () => {
    expect(estadoVolumen(undefined, undefined, true)).toEqual({ tipo: "sin_caudal" });
    expect(estadoVolumen(undefined, undefined, false)).toEqual({ tipo: "sin_caudal" });
  });

  it("ciclo cerrado sin volumen (anterior a esta función): sin caudal aunque haya caudal de planta", () => {
    expect(estadoVolumen(undefined, 18, false)).toEqual({ tipo: "sin_caudal" });
  });

  it("ciclo en curso con caudal pero sin suma todavía: acumulando", () => {
    expect(estadoVolumen(undefined, 18, true)).toEqual({ tipo: "acumulando" });
    expect(estadoVolumen(vc({}, { huecos: 2 }), 18, true)).toEqual({ tipo: "acumulando" });
  });

  it("un caudal de 0 m³/h es un caudal informado: acumulando, no 'sin caudal'", () => {
    expect(estadoVolumen(undefined, 0, true)).toEqual({ tipo: "acumulando" });
  });

  it("filas en el orden del ciclo, con la etapa que aún no corrió sin valor", () => {
    const e = estadoVolumen(vc({ preenjuague: 181.4, alcalino: 100 }), 18, true);
    expect(e.tipo).toBe("listo");
    if (e.tipo !== "listo") return;
    expect(e.filas.map((f) => f.etapa)).toEqual(["preenjuague", "alcalino", "enjuague", "acido", "enjuague_final"]);
    expect(e.filas.map((f) => f.litros)).toEqual([181.4, 100, null, null, null]);
    expect(e.total).toBeCloseTo(281.4, 10);
  });

  it("enjuagues en azul (monitoreada) y etapas químicas en ámbar", () => {
    const e = estadoVolumen(vc({ preenjuague: 1, alcalino: 1, enjuague: 1, acido: 1, enjuague_final: 1 }), 18, false);
    if (e.tipo !== "listo") throw new Error("debía estar listo");
    expect(Object.fromEntries(e.filas.map((f) => [f.etapa, f.monitoreada])))
      .toEqual({ preenjuague: true, alcalino: false, enjuague: true, acido: false, enjuague_final: true });
  });

  it("la desinfección solo aparece si tiene volumen, y entra en el total", () => {
    const sin = estadoVolumen(vc({ preenjuague: 100, desinfeccion: 0 }), 18, true);
    if (sin.tipo !== "listo") throw new Error("debía estar listo");
    expect(sin.filas.some((f) => f.etapa === "desinfeccion")).toBe(false);

    const con = estadoVolumen(vc({ preenjuague: 100, desinfeccion: 136.7 }), 18, true);
    if (con.tipo !== "listo") throw new Error("debía estar listo");
    expect(con.filas.at(-1)).toMatchObject({ etapa: "desinfeccion", litros: 136.7 });
    expect(con.total).toBeCloseTo(236.7, 10);
  });

  it("lleva la marca de simulado y los huecos", () => {
    const e = estadoVolumen(vc({ preenjuague: 5 }, { simulado: true, huecos: 3 }), 18, true);
    expect(e).toMatchObject({ tipo: "listo", simulado: true, huecos: 3 });
    expect(estadoVolumen(vc({ preenjuague: 5 }), 18, true)).toMatchObject({ simulado: false, huecos: 0 });
  });
});

describe("formatearLitros", () => {
  it("redondea a litros enteros con separador de miles", () => {
    expect(formatearLitros(1395.6)).toBe("1.396 L");
    expect(formatearLitros(181.4)).toBe("181 L");
  });
  it("sin valor muestra una raya, no 0 L", () => {
    expect(formatearLitros(null)).toBe("—");
  });
});
