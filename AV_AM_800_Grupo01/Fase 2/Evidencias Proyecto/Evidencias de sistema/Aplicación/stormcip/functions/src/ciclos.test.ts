import { describe, expect, it } from "vitest";
import { calcularIndicadoresCiclo, LecturaCruda } from "./ciclos";
import { PARAMS_DEFECTO } from "./types";

const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min, 0));

// Enjuague que arranca sucio (arrastre de soda) y baja hasta el criterio limpio.
// PARAMS_DEFECTO: aguaRed 150 µS/cm, criterio limpio 300 µS/cm y 20 NTU.
const ENJUAGUE: LecturaCruda[] = [
  { ts: t(0),  etapa: "enjuague", valores: { turbidez: 50 }, derivados: { conductividad25C: 1200 } },
  { ts: t(5),  etapa: "enjuague", valores: { turbidez: 30 }, derivados: { conductividad25C: 700 } },
  { ts: t(10), etapa: "enjuague", valores: { turbidez: 10 }, derivados: { conductividad25C: 250 } },
];

describe("calcularIndicadoresCiclo", () => {
  it("calcula tiempo hasta limpio desde la primera lectura de la etapa", () => {
    const r = calcularIndicadoresCiclo(ENJUAGUE, PARAMS_DEFECTO);
    expect(r.lecturasConsideradas).toBe(3);
    // la tercera lectura (min 10) es la primera que cumple ambos criterios
    expect(r.global?.derivados.tiempoHastaLimpio).toBe(600);
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