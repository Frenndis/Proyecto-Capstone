import { describe, expect, it } from "vitest";
import {
  calcularModeloPrograma, cicloParaModelo, claveModelo, percentil, predecirConsumo, recomendarEtapa,
} from "./modelosCiclo";

/** n ciclos con tiempos hasta limpio repartidos entre `desde` y `hasta` minutos. */
const tiemposMin = (n: number, desde: number, hasta: number) =>
  Array.from({ length: n }, (_, i) => Math.round((desde + ((hasta - desde) * i) / (n - 1)) * 60));

describe("percentil", () => {
  it("devuelve un valor que sí ocurrió", () => {
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentil([5, 1, 3], 50)).toBe(3);
    expect(percentil([7], 10)).toBe(7);
  });
});

describe("recomendarEtapa", () => {
  it("configurado en 30 min y listo en 17 a 19: sugiere bajar, por pasos", () => {
    const r = recomendarEtapa(tiemposMin(40, 17, 19), 30 * 60, 18);
    expect(r.estado).toBe("sugerencia");
    if (r.estado !== "sugerencia") return;
    expect(r.sugeridoS / 60).toBeGreaterThan(19);
    expect(r.sugeridoS / 60).toBeLessThan(22);
    // El primer paso no baja más de 10 %: de 30 a 27 min
    expect(r.siguientePasoS).toBe(27 * 60);
    // 18 m³/h = 5 L/s
    expect(r.ahorroAguaL).toBe((30 * 60 - r.sugeridoS) * 5);
    expect(r.ahorroPasoL).toBe(3 * 60 * 5);
  });

  it("el tiempo sugerido cubre al menos el 95 % de los ciclos", () => {
    const tiempos = tiemposMin(100, 10, 25);
    const r = recomendarEtapa(tiempos, 40 * 60, 18);
    if (r.estado !== "sugerencia") throw new Error(r.estado);
    expect(tiempos.filter((t) => t <= r.sugeridoS).length / tiempos.length).toBeGreaterThanOrEqual(0.95);
  });

  it("con pocos ciclos no sugiere nada", () => {
    expect(recomendarEtapa(tiemposMin(29, 17, 19), 1800, 18))
      .toEqual({ estado: "faltan_ciclos", ciclos: 29, requeridos: 30 });
  });

  it("sin tiempo configurado no hay contra qué comparar", () => {
    expect(recomendarEtapa(tiemposMin(30, 17, 19), null, 18).estado).toBe("sin_configuracion");
  });

  it("si más de 5 % de los ciclos no queda limpio, no recomienda acortar", () => {
    const tiempos: (number | null)[] = tiemposMin(30, 17, 19);
    tiempos[0] = tiempos[1] = null;
    expect(recomendarEtapa(tiempos, 1800, 18)).toMatchObject({ estado: "inestable", tasaSinLimpiar: 0.067 });
  });

  it("si el proceso ya usa casi todo el tiempo, no hay ahorro que sugerir", () => {
    expect(recomendarEtapa(tiemposMin(30, 27, 29), 1800, 18).estado).toBe("sin_ahorro");
  });

  it("nunca baja de la mitad de lo configurado", () => {
    const r = recomendarEtapa(tiemposMin(30, 2, 3), 1800, 18);
    expect(r).toMatchObject({ estado: "sugerencia", sugeridoS: 900 });
  });
});

describe("predecirConsumo", () => {
  it("con pocos ciclos no predice", () => {
    expect(predecirConsumo([1, 2, 3, 4])).toEqual({ estado: "faltan_ciclos", ciclos: 4, requeridos: 5 });
  });

  it("entrega el esperado, el rango y el error dejando un ciclo fuera", () => {
    const r = predecirConsumo([10, 10, 10, 10, 20]);
    expect(r).toMatchObject({ estado: "listo", ciclos: 5, esperado: 12, p10: 10, p90: 20 });
    // Cuatro ciclos: |10 − 12,5| = 2,5. El de 20: |20 − 10| = 10. Promedio: 4
    if (r.estado === "listo") expect(r.errorMedio).toBe(4);
  });

  it("sin variación, el error es cero", () => {
    expect(predecirConsumo([5, 5, 5, 5, 5])).toMatchObject({ esperado: 5, errorMedio: 0 });
  });
});

describe("cicloParaModelo", () => {
  it("una etapa sin agua limpia queda en null; una sin lecturas no aparece", () => {
    const c = cicloParaModelo({
      indicadoresPorEtapa: {
        enjuague_final: { derivados: {} },
        preenjuague: { derivados: { tiempoHastaLimpio: 9 } },
      },
    });
    expect(c.tiempoLimpio).toEqual({ enjuague_final: null });
  });
});

describe("calcularModeloPrograma", () => {
  const ciclo = (t: number | null, simulado = false) => ({
    receta: { enjuague: 40, enjuague_final: 60 },
    tiempoLimpio: { enjuague: 20, enjuague_final: t },
    consumos: { aguaTotal: 0.6, soda: 150, acido: 150 },
    simulado,
  });

  it("calcula las dos etapas y los tres consumos", () => {
    const m = calcularModeloPrograma(Array.from({ length: 30 }, () => ciclo(30)), 18);
    expect(m.etapas.enjuague_final).toMatchObject({ estado: "sugerencia", configuradoS: 60, sugeridoS: 33 });
    expect(m.etapas.enjuague).toMatchObject({ estado: "sugerencia", configuradoS: 40, sugeridoS: 22 });
    expect(m.consumo.aguaTotal).toMatchObject({ estado: "listo", esperado: 0.6 });
    expect(m.conDatosSimulados).toBe(false);
  });

  it("avisa si entrenó con datos simulados", () => {
    expect(calcularModeloPrograma([ciclo(30, true)], 18).conDatosSimulados).toBe(true);
  });
});

describe("claveModelo", () => {
  it("no deja caracteres que Firestore lea como ruta", () => {
    expect(claveModelo("cip-sim", "Demo CIP 300 s")).toBe("cip-sim__Demo_CIP_300_s");
  });
});
