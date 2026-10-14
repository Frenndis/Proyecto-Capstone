import { describe, expect, it } from "vitest";
import { FACTOR_HUECO, construirSerie, mediana } from "./serieTendencia";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const marca = (offsetS: number) => ({ toDate: () => new Date(T0 + offsetS * 1000) });
const lec = (offsetS: number, valores: Record<string, number | null>, derivados?: Record<string, number>) =>
  ({ ts: marca(offsetS), valores, derivados });

describe("mediana", () => {
  it("impar, par y vacío", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe("construirSerie", () => {
  const cada10 = [5, 15, 25, 35, 45, 55].map((s, i) => lec(s, { conductividad: 400 - i * 10 }));

  it("usa tiempo real en ms, ordenado aunque lleguen desordenadas", () => {
    const { puntos } = construirSerie([cada10[2], cada10[0], cada10[1]], "conductividad");
    expect(puntos.map((p) => p.t)).toEqual([T0 + 5000, T0 + 15000, T0 + 25000]);
    expect(puntos.map((p) => p.valor)).toEqual([400, 390, 380]);
  });

  it("toma derivados cuando la variable no es medida", () => {
    const { puntos } = construirSerie([lec(5, { conductividad: 300 }, { conductividad25C: 320 })], "conductividad25C");
    expect(puntos).toEqual([{ t: T0 + 5000, valor: 320 }]);
  });

  it("ignora lecturas sin valor (null, ausente) o sin ts", () => {
    const { puntos } = construirSerie([
      lec(5, { ph: 7 }), lec(15, { ph: null }), lec(25, {}), { ts: null, valores: { ph: 6 } },
    ], "ph");
    expect(puntos).toEqual([{ t: T0 + 5000, valor: 7 }]);
  });

  it("eje X: del inicio del ciclo al fin dado", () => {
    const s = construirSerie(cada10, "conductividad", { inicioMs: T0, finMs: T0 + 300_000 });
    expect(s.desdeMs).toBe(T0);
    expect(s.hastaMs).toBe(T0 + 300_000);
  });

  it("sin inicio ni fin usa la primera y la última lectura", () => {
    const s = construirSerie(cada10, "conductividad");
    expect(s.desdeMs).toBe(T0 + 5000);
    expect(s.hastaMs).toBe(T0 + 55_000);
  });

  it("una lectura anterior al inicio extiende el eje en vez de perderse", () => {
    const s = construirSerie([lec(-20, { ph: 7 }), lec(10, { ph: 7 })], "ph", { inicioMs: T0, finMs: T0 + 60_000 });
    expect(s.desdeMs).toBe(T0 - 20_000);
    expect(s.puntos).toHaveLength(2);
  });

  it("el fin nunca queda antes de la última lectura", () => {
    const s = construirSerie(cada10, "conductividad", { inicioMs: T0, finMs: T0 + 10_000 });
    expect(s.hastaMs).toBe(T0 + 55_000);
  });

  it("sin datos: serie vacía con eje válido", () => {
    const s = construirSerie([], "ph", { inicioMs: T0, finMs: T0 + 5000 });
    expect(s.puntos).toEqual([]);
    expect(s.hastaMs).toBeGreaterThan(s.desdeMs);
    const vacia = construirSerie([], "ph");
    expect(vacia.hastaMs).toBeGreaterThan(vacia.desdeMs);
  });

  describe("huecos", () => {
    it("cadencia uniforme: no corta nada", () => {
      expect(construirSerie(cada10, "conductividad").huecos).toBe(0);
    });

    it("un intervalo mayor que FACTOR_HUECO × mediana inserta un punto sin valor en medio", () => {
      const conHueco = [5, 15, 25, 35, 35 + 10 * FACTOR_HUECO + 10].map((s) => lec(s, { conductividad: 300 }));
      const { puntos, huecos } = construirSerie(conHueco, "conductividad");
      expect(huecos).toBe(1);
      const i = puntos.findIndex((p) => p.valor === null);
      expect(i).toBe(4);
      expect(puntos[i].t).toBe((puntos[i - 1].t + puntos[i + 1].t) / 2);
    });

    it("exactamente el límite no es hueco", () => {
      const justo = [5, 15, 25, 35, 35 + 10 * FACTOR_HUECO].map((s) => lec(s, { conductividad: 300 }));
      expect(construirSerie(justo, "conductividad").huecos).toBe(0);
    });

    it("con pocas lecturas no hay cadencia: no corta", () => {
      const pocas = [lec(5, { ph: 7 }), lec(15, { ph: 7 }), lec(3600, { ph: 7 })];
      expect(construirSerie(pocas, "ph").huecos).toBe(0);
    });

    it("el umbral se adapta a la cadencia (20 min)", () => {
      const m = (n: number) => lec(n * 1200, { ph: 7 });
      const s = construirSerie([m(0), m(1), m(2), m(3), m(10)], "ph");
      expect(s.huecos).toBe(1);
      expect(construirSerie([m(0), m(1), m(2), m(3), m(4)], "ph").huecos).toBe(0);
    });
  });
});
