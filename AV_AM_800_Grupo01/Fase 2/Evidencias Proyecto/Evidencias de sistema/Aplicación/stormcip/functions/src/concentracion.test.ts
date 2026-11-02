import { describe, expect, it } from "vitest";
import {
  calcularQuimica, compensarA25, concentracionDesdeKappa, reposicionEstanque, titulacionNaOH,
} from "./concentracion";
import {
  CONFIG_CONCENTRACION_DEFECTO, ConfigConcentracion, configConcentracion,
} from "./concentracionConfig";

// Con los parámetros de ejemplo (NaOH: α 0,019, m 50 mS/cm por 1 %, b 0, agua < 5 mS/cm),
// κ25 = 50 000 µS/cm equivale a 1,0 %.
describe("compensarA25", () => {
  it("a 25 °C no cambia la conductividad", () => {
    expect(compensarA25(50000, 25, 0.019)).toBe(50000);
  });
  it("sobre 25 °C la baja y bajo 25 °C la sube", () => {
    expect(compensarA25(59500, 35, 0.019)).toBeCloseTo(50000, 6);   // 1 + 0,019·10 = 1,19
    expect(compensarA25(40500, 15, 0.019)).toBeCloseTo(50000, 6);   // 1 − 0,019·10 = 0,81
  });
  it("con un factor no positivo devuelve la conductividad sin compensar", () => {
    expect(compensarA25(1000, -30, 0.02)).toBe(1000);
  });
});

describe("concentracionDesdeKappa", () => {
  it("% = (κ25 − b) / m", () => {
    expect(concentracionDesdeKappa(50, 50, 0)).toBe(1);
    expect(concentracionDesdeKappa(26, 50, 1)).toBe(0.5);
  });
});

describe("calcularQuimica — cálculo", () => {
  it("NaOH a 25 °C: 50 000 µS/cm → 1,0 %", () => {
    const r = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 50000, tempEc: 25 } });
    expect(r).toMatchObject({
      fase: "soda", quimico: "NaOH", kappa25: 50000, concentracionQuimica: 1,
      confianza: "estimado", motivo: null,
    });
    expect(r.metodo).toContain("1 + 0.019");
  });

  it("temperaturas distintas de 25 °C: la misma solución da la misma concentración", () => {
    const caliente = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 59500, tempEc: 35 } });
    const fria = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 40500, tempEc: 15 } });
    expect(caliente.kappa25).toBe(50000);
    expect(caliente.concentracionQuimica).toBe(1);
    expect(fria.kappa25).toBe(50000);
    expect(fria.concentracionQuimica).toBe(1);
  });

  it("ácido: fase 'acido' y su propio químico", () => {
    const r = calcularQuimica({ etapa: "acido", valores: { conductividad: 25000 * 2, tempEc: 25 } });
    expect(r).toMatchObject({ fase: "acido", quimico: "acido", concentracionQuimica: 1 });
  });

  it("usa el α del químico, no un valor fijo", () => {
    const config: ConfigConcentracion = {
      ...CONFIG_CONCENTRACION_DEFECTO,
      quimicos: { ...CONFIG_CONCENTRACION_DEFECTO.quimicos, NaOH: { alpha: 0.02, m: 50, b: 0, umbralAguaMScm: 5 } },
    };
    const r = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 60000, tempEc: 35 }, config });
    expect(r.kappa25).toBe(50000);   // 60000 / 1,2
  });

  it("prefiere la temperatura de la sonda EC sobre la de pH", () => {
    const r = calcularQuimica({
      etapa: "alcalino", valores: { conductividad: 59500, tempEc: 35, tempSonda: 25 },
    });
    expect(r.kappa25).toBe(50000);
  });

  it("aplica la ordenada b de la curva", () => {
    const config: ConfigConcentracion = {
      ...CONFIG_CONCENTRACION_DEFECTO,
      quimicos: { ...CONFIG_CONCENTRACION_DEFECTO.quimicos, NaOH: { alpha: 0.019, m: 50, b: 2, umbralAguaMScm: 5 } },
    };
    const r = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 52000, tempEc: 25 }, config });
    expect(r.concentracionQuimica).toBe(1);   // (52 − 2) / 50
  });
});

describe("calcularQuimica — fase agua", () => {
  it("κ25 bajo el umbral de agua: fase agua y concentración null, sin falta de confianza", () => {
    const r = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 1500, tempEc: 25 } });
    expect(r).toMatchObject({
      fase: "agua", quimico: "NaOH", kappa25: 1500, concentracionQuimica: null, confianza: null,
    });
    expect(r.motivo).toContain("umbral de agua");
  });

  it("justo en el umbral ya cuenta como químico", () => {
    const r = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 5000, tempEc: 25 } });
    expect(r.fase).toBe("soda");
    expect(r.concentracionQuimica).toBe(0.1);
  });

  it("etapa sin químico (enjuague): fase agua aunque la EC sea alta por arrastre", () => {
    const r = calcularQuimica({ etapa: "enjuague", valores: { conductividad: 60000, tempEc: 25 } });
    expect(r).toMatchObject({
      fase: "agua", quimico: null, kappa25: null, concentracionQuimica: null, confianza: null,
    });
    expect(r.motivo).toContain("enjuague");
  });
});

describe("calcularQuimica — lecturas no confiables: null, confianza baja y motivo", () => {
  const valores = { conductividad: 50000, tempEc: 25 };

  it("conductividad saturada", () => {
    const r = calcularQuimica({ etapa: "alcalino", valores: { ...valores, conductividad: 2000 }, confianza: { conductividad: "saturado" } });
    expect(r).toMatchObject({ fase: "soda", kappa25: null, concentracionQuimica: null, confianza: "baja" });
    expect(r.motivo).toContain("saturada");
  });

  it("conductividad fuera de operación", () => {
    const r = calcularQuimica({ etapa: "alcalino", valores, confianza: { conductividad: "fuera_de_operacion" } });
    expect(r).toMatchObject({ concentracionQuimica: null, confianza: "baja" });
    expect(r.motivo).toContain("fuera de operación");
  });

  it("temperatura saturada o fuera de operación", () => {
    const sat = calcularQuimica({ etapa: "alcalino", valores, confianza: { tempEc: "saturado" } });
    const fuera = calcularQuimica({ etapa: "alcalino", valores, confianza: { tempEc: "fuera_de_operacion" } });
    expect(sat).toMatchObject({ concentracionQuimica: null, confianza: "baja" });
    expect(sat.motivo).toContain("temperatura saturada");
    expect(fuera).toMatchObject({ concentracionQuimica: null, confianza: "baja" });
    expect(fuera.motivo).toContain("temperatura fuera de operación");
  });

  it("falta la temperatura o la conductividad", () => {
    const sinT = calcularQuimica({ etapa: "alcalino", valores: { conductividad: 50000 } });
    const sinEc = calcularQuimica({ etapa: "alcalino", valores: { tempEc: 25 } });
    expect(sinT).toMatchObject({ concentracionQuimica: null, confianza: "baja", motivo: "falta la temperatura" });
    expect(sinEc).toMatchObject({ concentracionQuimica: null, confianza: "baja" });
    expect(sinEc.motivo).toContain("conductividad");
  });
});

describe("calcularQuimica — sensorYaCompensa", () => {
  const entrada = { etapa: "alcalino" as const, valores: { conductividad: 50000, tempEc: 35 }, modeloSonda: "DR-ECK1.0" as const };
  const compensa = (v: boolean): ConfigConcentracion => ({
    ...CONFIG_CONCENTRACION_DEFECTO, sensorYaCompensa: { "DR-ECK1.0": v },
  });

  it("false (por defecto): aplica la fórmula de compensación", () => {
    const r = calcularQuimica({ ...entrada, config: compensa(false) });
    expect(r.kappa25).toBe(42016.8);              // 50000 / 1,19
    expect(r.concentracionQuimica).toBe(0.84);
    expect(calcularQuimica(entrada).kappa25).toBe(42016.8);   // sin config explícita
  });

  it("true: κ25 = EC reportada, sin aplicar la fórmula", () => {
    const r = calcularQuimica({ ...entrada, config: compensa(true) });
    expect(r.kappa25).toBe(50000);
    expect(r.concentracionQuimica).toBe(1);
    expect(r.metodo).toContain("ya compensa");
  });

  it("true: no necesita la temperatura", () => {
    const r = calcularQuimica({ ...entrada, valores: { conductividad: 50000 }, config: compensa(true) });
    expect(r.concentracionQuimica).toBe(1);
  });

  it("true: una EC saturada sigue sin calcularse", () => {
    const r = calcularQuimica({ ...entrada, confianza: { conductividad: "saturado" }, config: compensa(true) });
    expect(r).toMatchObject({ concentracionQuimica: null, confianza: "baja" });
  });

  it("el flag es por sonda: otro modelo sin entrada se compensa", () => {
    const r = calcularQuimica({ ...entrada, modeloSonda: "DR-ECK10.0", config: compensa(true) });
    expect(r.kappa25).toBe(42016.8);
  });
});

describe("configConcentracion", () => {
  it("sin nada guardado devuelve los valores por defecto", () => {
    expect(configConcentracion(undefined)).toEqual(CONFIG_CONCENTRACION_DEFECTO);
    expect(configConcentracion(null)).toEqual(CONFIG_CONCENTRACION_DEFECTO);
  });

  it("mezcla por campo: lo editado cambia y el resto queda", () => {
    const c = configConcentracion({
      quimicos: { NaOH: { m: 45 } },
      sensorYaCompensa: { "DR-ECK1.0": true },
    });
    expect(c.quimicos.NaOH).toEqual({ ...CONFIG_CONCENTRACION_DEFECTO.quimicos.NaOH, m: 45 });
    expect(c.quimicos.acido).toEqual(CONFIG_CONCENTRACION_DEFECTO.quimicos.acido);
    expect(c.sensorYaCompensa["DR-ECK1.0"]).toBe(true);
    expect(c.sensorYaCompensa["DR-ECK10.0"]).toBe(false);
  });

  it("ignora valores inválidos en vez de romper la ingesta", () => {
    const c = configConcentracion({
      quimicos: { NaOH: { alpha: "mucho", m: NaN } }, sensorYaCompensa: { "DR-ECK1.0": "sí" },
    });
    expect(c).toEqual(CONFIG_CONCENTRACION_DEFECTO);
  });
});

describe("fórmulas auxiliares", () => {
  it("titulación: %NaOH = V·N·4 / V_muestra", () => {
    expect(titulacionNaOH(10, 0.1, 10)).toBeCloseTo(0.4, 10);
    expect(titulacionNaOH(25, 0.5, 10)).toBeCloseTo(5, 10);
  });

  it("reposición: V_conc = V_estanque · (C_obj − C_act) / (C_conc − C_obj)", () => {
    expect(reposicionEstanque(1000, 1.5, 1.0, 30)).toBeCloseTo(17.5439, 4);
  });

  it("reposición: sin solución si el concentrado no supera al objetivo", () => {
    expect(reposicionEstanque(1000, 1.5, 1.0, 1.5)).toBeNull();
    expect(reposicionEstanque(1000, 1.5, 1.0, 1)).toBeNull();
  });
});
