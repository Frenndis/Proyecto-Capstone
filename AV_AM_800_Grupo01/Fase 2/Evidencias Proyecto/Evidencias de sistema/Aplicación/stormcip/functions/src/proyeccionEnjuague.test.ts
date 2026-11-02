import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  CriterioProyeccion, ETAPAS_PROYECCION, MuestraEnjuague, documentoProyeccion, muestraDeLectura, proyectarEnjuague,
  tStudent95,
} from "./proyeccionEnjuague";
import { compensarConductividad } from "./calculos";
import { PARAMS_DEFECTO } from "./types";
import { PARAMS_MODELO_DEFECTO, RECETA_DEFECTO, estadoEn } from "./simulacion/modeloCip";

const CRITERIO: CriterioProyeccion = { cAguaUsCm: 150, criterioEc25: 200, criterioTurbidez: 10 };

/** Curva exponencial ideal, una lectura por minuto. */
const curva = (minutos: number[], a = 1800, tauMin = 3, cAgua = 150): MuestraEnjuague[] =>
  minutos.map((m) => ({ tMs: m * 60000, ec25: cAgua + a * Math.exp(-m / tauMin), saturada: false }));

/** Minuto exacto en que esa curva ideal cruza 200 µS/cm. */
const cruceIdeal = (a = 1800, tauMin = 3) => tauMin * Math.log(a / 50);

describe("proyectarEnjuague", () => {
  it("con una curva exponencial ideal acierta el instante de limpieza", () => {
    const r = proyectarEnjuague(curva([0, 1, 2, 3, 4]), CRITERIO);
    expect(r.estado).toBe("proyectando");
    if (r.estado !== "proyectando") return;
    expect(r.limpioEnMs / 60000).toBeCloseTo(cruceIdeal(), 2);
    expect(r.tauS).toBeCloseTo(180, 0);
    expect(r.r2).toBeCloseTo(1, 3);
    // Sin ruido el intervalo se reduce al valor central
    expect(r.restanteMaxS - r.restanteMinS).toBeLessThanOrEqual(1);
  });

  it("el orden de llegada de las lecturas no cambia el resultado", () => {
    const orden = curva([0, 1, 2, 3, 4]);
    const a = proyectarEnjuague(orden, CRITERIO);
    const b = proyectarEnjuague([orden[3], orden[0], orden[4], orden[2], orden[1]], CRITERIO);
    expect(b).toEqual(a);
  });

  it("con ruido, el intervalo contiene el instante real y se informa más ancho", () => {
    const ruido = [12, -9, 7, -11, 8, -6, 5, -4];
    const muestras = curva([0, 1, 2, 3, 4, 5, 6, 7]).map((m, i) => ({ ...m, ec25: m.ec25 + ruido[i] }));
    const r = proyectarEnjuague(muestras, CRITERIO);
    expect(r.estado).toBe("proyectando");
    if (r.estado !== "proyectando") return;
    const realRestanteS = (cruceIdeal() - 7) * 60;
    expect(r.restanteMinS).toBeLessThanOrEqual(realRestanteS);
    expect(r.restanteMaxS).toBeGreaterThanOrEqual(realRestanteS);
    expect(r.restanteMaxS).toBeGreaterThan(r.restanteMinS);
  });

  it("con menos de 5 lecturas no proyecta", () => {
    expect(proyectarEnjuague([], CRITERIO).estado).toBe("datos_insuficientes");
    expect(proyectarEnjuague(curva([0, 1, 2, 3]), CRITERIO).estado).toBe("datos_insuficientes");
  });

  it("todas en el mismo instante no permiten ajustar una recta", () => {
    const m = { tMs: 0, ec25: 900, saturada: false };
    expect(proyectarEnjuague([m, m, m, m, m], CRITERIO).estado).toBe("datos_insuficientes");
  });

  it("un salto de la señal no se confunde con una caída", () => {
    const salto = [2029, 555, 551, 548, 530].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(salto, CRITERIO).estado).toBe("no_converge");
  });

  it("las lecturas saturadas no entran al ajuste", () => {
    const sat = { tMs: -60000, ec25: 2000, saturada: true };
    const conSat = proyectarEnjuague([sat, ...curva([0, 1, 2, 3, 4])], CRITERIO);
    expect(conSat).toEqual(proyectarEnjuague(curva([0, 1, 2, 3, 4]), CRITERIO));
    expect(proyectarEnjuague([sat, sat, sat, sat], CRITERIO).estado).toBe("datos_insuficientes");
  });

  it("ajusta desde el máximo: la subida inicial del químico no distorsiona la curva", () => {
    const subida = [{ tMs: -120000, ec25: 400, saturada: false }, { tMs: -60000, ec25: 1200, saturada: false }];
    const r = proyectarEnjuague([...subida, ...curva([0, 1, 2, 3, 4])], CRITERIO);
    expect(r.estado).toBe("proyectando");
    if (r.estado === "proyectando") expect(r.limpioEnMs / 60000).toBeCloseTo(cruceIdeal(), 2);
  });

  it("una curva plana sobre el criterio no converge", () => {
    const plana = [412, 405, 410, 407, 409, 406].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(plana, CRITERIO).estado).toBe("no_converge");
  });

  it("una conductividad que sube no converge", () => {
    const sube = [300, 320, 345, 370, 400].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    // Desde el máximo solo queda una lectura
    expect(proyectarEnjuague(sube, CRITERIO).estado).toBe("datos_insuficientes");
    const conPico = [900, 300, 320, 345, 370, 400].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(conPico, CRITERIO).estado).toBe("no_converge");
  });

  it("una curva que cae y se estanca sobre el criterio no converge", () => {
    const estancada = [1500, 1000, 700, 520, 430, 390, 372, 365, 361, 359]
      .map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(estancada, CRITERIO).estado).toBe("no_converge");
  });

  it("una caída tan lenta que supera el horizonte no converge", () => {
    expect(proyectarEnjuague(curva([0, 1, 2, 3, 4], 500, 300), CRITERIO).estado).toBe("no_converge");
  });

  it("no promete un plazo mucho más largo que lo ya observado", () => {
    // Caída limpia, pero faltarían unos 32 min habiendo visto solo 4
    expect(proyectarEnjuague(curva([0, 1, 2, 3, 4], 1800, 10), CRITERIO).estado).toBe("no_converge");
    // La misma curva, ya con 12 min observados, sí se proyecta
    const r = proyectarEnjuague(curva([0, 2, 4, 6, 8, 10, 12], 1800, 10), CRITERIO);
    expect(r.estado).toBe("proyectando");
  });

  it("si el criterio no supera al agua de entrada, no hay proyección posible", () => {
    const r = proyectarEnjuague(curva([0, 1, 2, 3]), { ...CRITERIO, criterioEc25: 150 });
    expect(r.estado).toBe("sin_criterio");
  });

  it("si la última lectura cumple, informa limpio y desde cuándo", () => {
    const m = [900, 500, 190, 180, 170].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(m, CRITERIO)).toEqual({ estado: "limpio", muestras: 5, limpioDesdeMs: 2 * 60000 });
  });

  it("un rebote sobre el criterio deja de contar como limpio", () => {
    const m = [900, 500, 190, 180, 260].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(m, CRITERIO).estado).not.toBe("limpio");
  });

  it("limpio cuenta desde el último tramo continuo, no desde el primer cruce", () => {
    const m = [190, 260, 190, 180].map((ec25, i) => ({ tMs: i * 60000, ec25, saturada: false }));
    expect(proyectarEnjuague(m, CRITERIO)).toMatchObject({ estado: "limpio", limpioDesdeMs: 2 * 60000 });
  });

  it("con conductividad lista y turbidez alta, queda pendiente de la turbidez", () => {
    const m = [{ tMs: 0, ec25: 180, saturada: false, turbidez: 25 }];
    expect(proyectarEnjuague(m, CRITERIO).estado).toBe("turbidez_pendiente");
    const fuera = [{ tMs: 0, ec25: 180, saturada: false, turbidezFuera: true }];
    expect(proyectarEnjuague(fuera, CRITERIO).estado).toBe("turbidez_pendiente");
  });

  it("con turbidez dentro del criterio, informa limpio", () => {
    const m = [{ tMs: 0, ec25: 180, saturada: false, turbidez: 4 }];
    expect(proyectarEnjuague(m, CRITERIO).estado).toBe("limpio");
  });
});

describe("ETAPAS_PROYECCION", () => {
  it("excluye el preenjuague (agua recuperada) y las etapas químicas", () => {
    expect(ETAPAS_PROYECCION).toEqual(["enjuague", "enjuague_final"]);
  });
});

describe("tStudent95", () => {
  it("baja al aumentar los grados de libertad", () => {
    expect(tStudent95(2)).toBe(4.3);
    expect(tStudent95(10)).toBe(2.23);
    expect(tStudent95(25)).toBe(2.09);
    expect(tStudent95(100)).toBe(1.96);
  });
});

describe("muestraDeLectura", () => {
  const ts = Timestamp.fromMillis(1000);

  it("toma EC25, saturación y turbidez de la lectura", () => {
    expect(muestraDeLectura({
      ts, derivados: { conductividad25C: 300 }, valores: { turbidez: 5 },
      confianza: { conductividad25C: "saturado", turbidez: "fuera_de_operacion" },
    })).toEqual({ tMs: 1000, ec25: 300, saturada: true, turbidez: 5, turbidezFuera: true });
  });

  it("sin EC25 (sonda fuera de operación o equipo sin conductividad) no hay muestra", () => {
    expect(muestraDeLectura({ ts, derivados: {} })).toBeNull();
    expect(muestraDeLectura({ ts })).toBeNull();
  });
});

describe("documentoProyeccion", () => {
  const ts = Timestamp.fromMillis(0);

  it("nunca lleva undefined: Firestore lo rechazaría", () => {
    const casos = [
      proyectarEnjuague([], CRITERIO),
      proyectarEnjuague(curva([0, 1, 2, 3, 4]), CRITERIO),
      proyectarEnjuague([{ tMs: 0, ec25: 180, saturada: false }], CRITERIO),
    ];
    for (const r of casos) {
      const doc = documentoProyeccion("enjuague", ts, r, CRITERIO);
      expect(Object.values(doc)).not.toContain(undefined);
    }
  });

  it("una proyección se declara estimada; una lectura que ya cumple, medida", () => {
    const p = documentoProyeccion("enjuague", ts, proyectarEnjuague(curva([0, 1, 2, 3, 4]), CRITERIO), CRITERIO);
    expect(p).toMatchObject({ estado: "proyectando", confianza: "estimado" });
    const l = documentoProyeccion("enjuague", ts, proyectarEnjuague([{ tMs: 0, ec25: 180, saturada: false }], CRITERIO), CRITERIO);
    expect(l).toMatchObject({ estado: "limpio", confianza: "medido" });
  });
});

// El modelo físico de la demo no es exponencial por construcción de este módulo:
// comprueba que la proyección funcione con curvas producidas por otro código.
describe("con el modelo de simulación del ciclo", () => {
  const paso = RECETA_DEFECTO.find((p) => p.etapa === "enjuague_final")!;
  const inicioS = RECETA_DEFECTO.slice(0, RECETA_DEFECTO.indexOf(paso)).reduce((s, p) => s + p.duracionS, 0);
  const ec25En = (t: number, esc: "normal" | "falla", semilla: number) => {
    const s = estadoEn(t, RECETA_DEFECTO, esc, { ...PARAMS_MODELO_DEFECTO, semilla }).sondas;
    return compensarConductividad(s.conductividad, s.tempEc, PARAMS_DEFECTO.factorCompensacionEC);
  };
  const muestras = (hastaS: number, esc: "normal" | "falla", semilla: number) => {
    const out: MuestraEnjuague[] = [];
    for (let tE = 1; tE <= hastaS; tE += 2) {
      const ec25 = ec25En(inicioS + tE, esc, semilla);
      out.push({ tMs: tE * 1000, ec25, saturada: ec25 >= 2000 });
    }
    return out;
  };
  const c: CriterioProyeccion = {
    cAguaUsCm: PARAMS_DEFECTO.conductividadAguaRed,
    criterioEc25: PARAMS_DEFECTO.criterioLimpio.conductividad25C,
    criterioTurbidez: PARAMS_DEFECTO.criterioLimpio.turbidez,
  };
  const SEMILLAS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23];

  it.each(SEMILLAS)("normal, semilla %i: desde 2/3 del tramo proyecta el cruce real con menos de 25 % de error", (semilla) => {
    let cruceS: number | null = null;
    for (let tE = 1; tE <= paso.duracionS && cruceS === null; tE += 2) {
      if (ec25En(inicioS + tE, "normal", semilla) <= c.criterioEc25) cruceS = tE;
    }
    expect(cruceS).not.toBeNull();
    const r = proyectarEnjuague(muestras(Math.floor((cruceS! * 2) / 3), "normal", semilla), c);
    expect(r.estado).toBe("proyectando");
    if (r.estado !== "proyectando") return;
    expect(Math.abs(r.limpioEnMs / 1000 - cruceS!) / cruceS!).toBeLessThan(0.25);
  });

  it.each(SEMILLAS)("falla, semilla %i: en ningún momento promete una hora de limpieza", (semilla) => {
    for (let hasta = 3; hasta < paso.duracionS; hasta += 2) {
      expect(proyectarEnjuague(muestras(hasta, "falla", semilla), c).estado).not.toBe("proyectando");
    }
  });
});
