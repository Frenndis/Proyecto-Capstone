import { describe, expect, it } from "vitest";
import {
  CIRCUITOS, CRITERIO_LIMPIO, cicloCerrado, circuitoPorId, crearSimulador, curvaCompleta, resumir,
} from "./motor";
import { CicloDecision, calcularDecisiones, percentil } from "./decisiones";

const and2 = circuitoPorId("and2")!;
const DIA = 86400000;
const AHORA = Date.UTC(2026, 10, 2, 15);

describe("motor", () => {
  it("cada receta consume el agua de su ficha", () => {
    const silo = circuitoPorId("silo3")!;
    expect(resumir(silo, { semilla: 1 }).aguaL).toBeGreaterThan(5000);
    expect(resumir(silo, { semilla: 1 }).aguaL).toBeLessThan(5400);
    expect(resumir(and2, { semilla: 1 }).aguaL).toBeGreaterThan(1950);
  });

  it("es determinista: la misma semilla da la misma curva", () => {
    expect(curvaCompleta(and2, { semilla: 7 })).toEqual(curvaCompleta(and2, { semilla: 7 }));
    expect(curvaCompleta(and2, { semilla: 7 })).not.toEqual(curvaCompleta(and2, { semilla: 8 }));
  });

  it("un ciclo normal queda validado y la temperatura cumple el mínimo", () => {
    const r = resumir(and2, { semilla: 3 });
    expect(r.validacion).toBe("validado");
    expect(r.tempMinSoda).toBeGreaterThanOrEqual(65);
  });

  it("un desvío extiende la soda 2 min y queda como corregido", () => {
    const n = resumir(and2, { semilla: 3 }), d = resumir(and2, { semilla: 3, desvio: true });
    expect(d.duracionS - n.duracionS).toBe(120);
    expect(d.validacion).toBe("desvio");
    expect(d.fases[1].estado).toBe("corregido");
    expect(d.tempMinSoda).toBeLessThan(65);
  });

  it("si la soda nunca llega a su mínimo, el ciclo queda fuera de límite", () => {
    expect(resumir(and2, { semilla: 3, fuera: true }).validacion).toBe("fuera");
  });

  it("los enjuagues caen bajo el criterio de agua limpia antes del fin de la fase", () => {
    const sim = crearSimulador(and2, { semilla: 3 });
    const iFinal = and2.fases.findIndex((f) => f.n === "Enjuague final");
    const fin = sim.en(sim.inicioDe(iFinal) + sim.durDe(iFinal) - 1);
    expect(fin.ec).toBeLessThanOrEqual(CRITERIO_LIMPIO);
    const f = resumir(and2, { semilla: 3 }).fases[iFinal];
    expect(f.limpioS).toBeGreaterThan(0);
    expect(f.limpioS).toBeLessThan(f.durS);
  });

  it("el ciclo cerrado lleva todo lo que necesitan las pantallas", () => {
    const c = cicloCerrado(and2, { semilla: 1 }, AHORA, "CIP-0001");
    expect(c).toMatchObject({ numero: "CIP-0001", circuitoId: "and2", estado: "finalizado", simulado: true });
    expect(c.curva.length).toBeGreaterThan(50);
    expect(c.fases[0]).toHaveProperty("min");
    expect(JSON.stringify(c)).not.toContain("undefined");
  });

  it("todos los circuitos entregan un ciclo válido", () => {
    for (const c of CIRCUITOS) expect(["validado", "desvio"]).toContain(resumir(c, { semilla: 11 }).validacion);
  });
});

function historia(id: string, n: number, o: { desvios?: number; fugaDesde?: number } = {}): CicloDecision[] {
  const c = circuitoPorId(id)!;
  const litrosPorS = Object.fromEntries(c.fases.map((f) => [f.n, (f.q * 1000 / 3600) * f.fresh]));
  return Array.from({ length: n }, (_, i) => {
    const dias = n - i;
    const desvio = o.desvios !== undefined && dias <= 14 && i % o.desvios === 0;
    return {
      circuitoId: id, circuito: c.nombre, inicioMs: AHORA - dias * DIA, litrosPorS,
      resumen: resumir(c, { semilla: i + 1, desvio, fugaFinal: o.fugaDesde !== undefined && dias <= o.fugaDesde ? 1.8 : undefined }),
    };
  });
}

describe("calcularDecisiones", () => {
  it("con historia suficiente propone acortar y lo traduce en agua al mes", () => {
    const { decisiones, totales } = calcularDecisiones(historia("silo3", 60), AHORA);
    const d = decisiones.find((x) => x.tipo === "acortar_enjuague")!;
    expect(d.sugeridoS!).toBeLessThan(d.configuradoS!);
    expect(d.p95S!).toBeLessThanOrEqual(d.sugeridoS!);
    expect(d.primerPasoS!).toBe(Math.ceil(d.configuradoS! * 0.9));
    expect(d.aguaMesL).toBeGreaterThan(0);
    expect(d.titulo).toContain("Silo 3");
    expect(totales.aguaMesL).toBeGreaterThan(0);
  });

  it("el tiempo sugerido cubre el 95 % de los ciclos", () => {
    const h = historia("silo3", 60);
    const d = calcularDecisiones(h, AHORA).decisiones.find((x) => x.tipo === "acortar_enjuague")!;
    const tiempos = h.map((c) => c.resumen.fases.find((f) => f.n === d.fase)!.limpioS!);
    expect(tiempos.filter((t) => t <= d.sugeridoS!).length / tiempos.length).toBeGreaterThanOrEqual(0.95);
  });

  it("con pocos ciclos no propone acortar", () => {
    expect(calcularDecisiones(historia("silo3", 20), AHORA).decisiones.filter((d) => d.tipo === "acortar_enjuague")).toEqual([]);
  });

  it("con desvíos repetidos pide revisar y no sugiere acortar ese circuito", () => {
    const { decisiones } = calcularDecisiones(historia("and2", 60, { desvios: 3 }), AHORA);
    expect(decisiones.some((d) => d.tipo === "revisar_circuito")).toBe(true);
    expect(decisiones.some((d) => d.tipo === "acortar_enjuague")).toBe(false);
  });

  it("detecta concentración sobre la receta y estima el químico ahorrado", () => {
    const d = calcularDecisiones(historia("past", 60), AHORA).decisiones.find((x) => x.tipo === "ajustar_dosis");
    expect(d).toBeDefined();
    expect(d!.quimicoMesL).toBeGreaterThan(0);
  });

  it("no inventa sobredosis en un circuito exacto", () => {
    expect(calcularDecisiones(historia("silo3", 60), AHORA).decisiones.some((d) => d.tipo === "ajustar_dosis")).toBe(false);
  });

  it("detecta el aumento de agua de un circuito con la misma duración", () => {
    const d = calcularDecisiones(historia("lle1", 60, { fugaDesde: 6 }), AHORA).decisiones.find((x) => x.tipo === "posible_fuga");
    expect(d).toBeDefined();
    expect(d!.titulo).toContain("Llenadora 1");
  });

  it("predice el consumo del próximo ciclo con rango y error", () => {
    const p = calcularDecisiones(historia("and2", 40), AHORA).predicciones[0];
    expect(p.circuitoId).toBe("and2");
    expect(p.aguaP10).toBeLessThanOrEqual(p.aguaL);
    expect(p.aguaP90).toBeGreaterThanOrEqual(p.aguaL);
    expect(p.aguaError).toBeGreaterThanOrEqual(0);
  });

  it("las alertas van antes que los ahorros", () => {
    const { decisiones } = calcularDecisiones([...historia("silo3", 60), ...historia("and2", 60, { desvios: 3 })], AHORA);
    expect(decisiones[0].tipo).toBe("revisar_circuito");
  });
});

describe("percentil", () => {
  it("usa el rango más cercano", () => {
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentil([5, 1, 3], 50)).toBe(3);
  });
});
