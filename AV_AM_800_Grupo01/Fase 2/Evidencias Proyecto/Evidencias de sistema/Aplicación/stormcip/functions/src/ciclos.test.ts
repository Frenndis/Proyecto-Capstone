import { describe, expect, it } from "vitest";
import { calcularIndicadoresCiclo, LecturaCruda } from "./ciclos";
import { PARAMS_DEFECTO } from "./types";

const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min, 0));

// Enjuague que arranca sucio (arrastre de soda) y baja hasta el criterio limpio.
// PARAMS_DEFECTO: aguaRed 150 µS/cm, criterio limpio 200 µS/cm y 10 NTU.
const ENJUAGUE: LecturaCruda[] = [
  { ts: t(0),  etapa: "enjuague", valores: { turbidez: 50 }, derivados: { conductividad25C: 1200 } },
  { ts: t(5),  etapa: "enjuague", valores: { turbidez: 30 }, derivados: { conductividad25C: 700 } },
  { ts: t(10), etapa: "enjuague", valores: { turbidez: 10 }, derivados: { conductividad25C: 180 } },
];

const lectura = (min: number, etapa: string, ec25: number, turbidez = 5): LecturaCruda =>
  ({ ts: t(min), etapa, valores: { turbidez }, derivados: { conductividad25C: ec25 } });

describe("calcularIndicadoresCiclo", () => {
  it("calcula tiempo hasta limpio por etapa desde la primera lectura de la etapa", () => {
    const r = calcularIndicadoresCiclo(ENJUAGUE, PARAMS_DEFECTO);
    expect(r.lecturasConsideradas).toBe(3);
    // la tercera lectura (min 10) es la primera que cumple ambos criterios
    expect(r.porEtapa.enjuague?.derivados.tiempoHastaLimpio).toBe(600);
  });

  // El global solo mira el enjuague final: es el que decide si el estanque
  // quedó limpio. Un enjuague intermedio limpio no aprueba el ciclo.
  it("global sin valor si el enjuague intermedio queda limpio pero el final no", () => {
    const r = calcularIndicadoresCiclo([
      ...ENJUAGUE,
      lectura(60, "enjuague_final", 450), lectura(61, "enjuague_final", 440),
      lectura(62, "enjuague_final", 455),
    ], PARAMS_DEFECTO);
    expect(r.porEtapa.enjuague?.derivados.tiempoHastaLimpio).toBe(600);
    expect(r.porEtapa.enjuague_final?.derivados.tiempoHastaLimpio).toBeUndefined();
    expect(r.global?.derivados.tiempoHastaLimpio).toBeUndefined();
    expect(r.global?.metodo.tiempoHastaLimpio).toBeUndefined();
    expect(r.global?.confianza.tiempoHastaLimpio).toBeUndefined();
  });

  it("global = tiempo hasta limpio del enjuague final, desde su primera lectura", () => {
    const r = calcularIndicadoresCiclo([
      ...ENJUAGUE,
      lectura(60, "enjuague_final", 280), lectura(61, "enjuague_final", 230),
      lectura(62, "enjuague_final", 190),
    ], PARAMS_DEFECTO);
    expect(r.global?.derivados.tiempoHastaLimpio).toBe(120);   // min 62 − min 60
    expect(r.global?.derivados.tiempoHastaLimpio)
      .toBe(r.porEtapa.enjuague_final?.derivados.tiempoHastaLimpio);
    expect(r.global?.metodo.tiempoHastaLimpio).toMatch(/^enjuague final:/);
    expect(r.global?.confianza.tiempoHastaLimpio).toBe("medido");
  });

  it("global sin valor si no hay lecturas del enjuague final", () => {
    const r = calcularIndicadoresCiclo(ENJUAGUE, PARAMS_DEFECTO);
    expect(r.global?.derivados.tiempoHastaLimpio).toBeUndefined();
  });

  // Separación entre umbral de alerta (300) y criterio de limpieza (200)
  it("entre 10 y 20 NTU el agua es aceptable pero no limpia, aunque la conductividad cumpla", () => {
    const r = calcularIndicadoresCiclo([
      lectura(0, "enjuague_final", 180, 15), lectura(1, "enjuague_final", 170, 12),
      lectura(2, "enjuague_final", 165, 8),
    ], PARAMS_DEFECTO);
    expect(r.global?.derivados.tiempoHastaLimpio).toBe(120);   // recién con 8 NTU
  });

  it("entre 200 y 300 µS/cm el agua es aceptable pero no limpia", () => {
    const r = calcularIndicadoresCiclo([
      lectura(0, "enjuague_final", 280), lectura(1, "enjuague_final", 250),
    ], PARAMS_DEFECTO);
    expect(r.global?.derivados.tiempoHastaLimpio).toBeUndefined();
  });

  it("calcula el arrastre químico contra la conductividad del agua de red", () => {
    const r = calcularIndicadoresCiclo(ENJUAGUE, PARAMS_DEFECTO);
    expect(r.global?.derivados.arrastreQuimico).toBe(1050); // 1200 − 150
  });

  it("marca el volumen como estimado, no como medido", () => {
    const r = calcularIndicadoresCiclo(ENJUAGUE, PARAMS_DEFECTO);
    expect(r.global?.confianza.volumenEstimado).toBe("estimado");
  });

  it("ignora las etapas químicas: están fuera del alcance medible del WQS", () => {
    const conAlcalino: LecturaCruda[] = [
      ...ENJUAGUE,
      { ts: t(20), etapa: "alcalino", valores: {}, derivados: { conductividad25C: 45000 } },
    ];
    const r = calcularIndicadoresCiclo(conAlcalino, PARAMS_DEFECTO);
    expect(r.lecturasConsideradas).toBe(3);
    expect(r.porEtapa.alcalino).toBeUndefined();
  });

  it("devuelve global null si no hay ninguna lectura monitoreada", () => {
    const r = calcularIndicadoresCiclo(
      [{ ts: t(0), etapa: "acido", valores: {}, derivados: { conductividad25C: 9000 } }],
      PARAMS_DEFECTO,
    );
    expect(r.global).toBeNull();
    expect(r.lecturasConsideradas).toBe(0);
  });

  it("suma el volumen por etapa en vez de medir el lapso completo", () => {
    const dosEtapas: LecturaCruda[] = [
      { ts: t(0),  etapa: "preenjuague", derivados: { conductividad25C: 900 }, valores: {} },
      { ts: t(3),  etapa: "preenjuague", derivados: { conductividad25C: 400 }, valores: {} },
      // hueco: entremedio corre el alcalino, donde no hay enjuague
      { ts: t(60), etapa: "enjuague_final", derivados: { conductividad25C: 300 }, valores: {} },
      { ts: t(63), etapa: "enjuague_final", derivados: { conductividad25C: 160 }, valores: {} },
    ];
    const r = calcularIndicadoresCiclo(dosEtapas, PARAMS_DEFECTO);
    const porEtapa =
      (r.porEtapa.preenjuague?.derivados.volumenEstimado ?? 0) +
      (r.porEtapa.enjuague_final?.derivados.volumenEstimado ?? 0);
    expect(r.global?.derivados.volumenEstimado).toBeCloseTo(porEtapa, 3);
    // el lapso completo (63 min) daría ~18,9 m³; la suma por etapa, ~1,8
    expect(r.global!.derivados.volumenEstimado!).toBeLessThan(5);
  });
});