import { describe, expect, it } from "vitest";
import {
  RECETA_DEFECTO, duracionReceta, escalarReceta, estadoEn, etapaEn, instantesUplink,
  Escenario, Receta,
} from "./modeloCip";
import { encodeWqsFPort2 } from "../wqsEncoder";
import { decodeWqs } from "../wqsDecoder";
import { validarYLimpiarValores } from "../ingest";
import { derivarLectura } from "../calculos";
import { ETAPAS, ETAPAS_MONITOREADAS, PARAMS_DEFECTO, Sonda, Variable, fueraDeRango } from "../types";

// Configuración de seed.js: sondas de wqs-lb-01 y umbrales de proceso
const SONDAS_SEED: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",    activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK10.0", activa: true },
  s3: { sondaId: "s3", modelo: "DR-TS1",     activa: true },
  s4: { sondaId: "s4", modelo: "DS18B20",    activa: true },
};
const INICIAL = { ph: { min: 5, max: 11 }, turbidez: { max: 60 }, conductividad25C: { max: 3000 } };
const LIMPIO = { ph: { min: 6, max: 8.5 }, turbidez: { max: 20 }, conductividad25C: { max: 300 } };
const UMBRALES_SEED: Record<string, Record<string, { min?: number; max?: number }>> = {
  preenjuague: INICIAL, enjuague: INICIAL, enjuague_final: LIMPIO,
};

/**
 * Lo que el backend haría con el uplink en t, sin Firestore: encoder →
 * decodeWqs (fw 1.2) → mapeo de lorawanAdapter.ts → validación física de
 * ingest.ts → derivados de calculos.ts.
 */
function lecturaComoBackend(t: number, receta: Receta, escenario: Escenario) {
  const { estadoProceso, sondas } = estadoEn(t, receta, escenario);
  const r = decodeWqs(encodeWqsFPort2({
    bateriaV: 3.6, tempExterna: sondas.tempExterna, turbidez: sondas.turbidez,
    ecK10: sondas.conductividad, ecK10Temp: sondas.tempEc, ph: sondas.ph, phTemp: sondas.tempSonda,
  }), 2, "1.2");
  if (!r.ok || r.fPort !== 2) throw new Error("no decodificó");
  const d = r.datos;
  // Mismo mapeo que CAMPO_A_VARIABLE en lorawanAdapter.ts
  const valores = {
    ph: d.ph, tempSonda: d.phTemp, turbidez: d.turbidez,
    conductividad: d.ecK10, tempEc: d.ecK10Temp, tempExterna: d.tempExterna,
  };
  const v = validarYLimpiarValores(valores, SONDAS_SEED);
  if (!v.ok) throw new Error(v.error);
  const numericos: Partial<Record<Variable, number>> = {};
  for (const [k, n] of Object.entries(v.limpios)) if (typeof n === "number") numericos[k as Variable] = n;
  const { derivados } = derivarLectura(numericos, PARAMS_DEFECTO);
  return { etapa: estadoProceso.etapa, limpios: v.limpios, descartadas: v.descartadas,
           evaluables: { ...numericos, ...derivados } as Record<string, number> };
}

function alertasDe(escenario: Escenario) {
  const alertas: string[] = [];
  for (const t of instantesUplink(RECETA_DEFECTO)) {
    const l = lecturaComoBackend(t, RECETA_DEFECTO, escenario);
    const rangos = UMBRALES_SEED[l.etapa] ?? {};
    for (const [v, valor] of Object.entries(l.evaluables)) {
      if (fueraDeRango(valor, rangos[v])) alertas.push(`${l.etapa}/${v}@${t}s=${valor}`);
    }
  }
  return alertas;
}

describe("receta", () => {
  it("la receta por defecto dura 300 s y sigue el orden de ETAPAS", () => {
    expect(duracionReceta(RECETA_DEFECTO)).toBe(300);
    expect(RECETA_DEFECTO.map((p) => p.etapa)).toEqual([...ETAPAS]);
  });

  it("escalarReceta mantiene proporciones y suma exacta", () => {
    const r = escalarReceta(RECETA_DEFECTO, 450);
    expect(duracionReceta(r)).toBe(450);
    expect(r[1]).toEqual({ etapa: "alcalino", duracionS: 105 });
    expect(duracionReceta(escalarReceta(RECETA_DEFECTO, 301))).toBe(301);
  });

  it("escalarReceta rechaza duraciones que dejan etapas de menos de 6 s", () => {
    expect(() => escalarReceta(RECETA_DEFECTO, 30)).toThrow(/demasiado corta/);
  });

  it("etapaEn ubica cada instante en su etapa", () => {
    expect(etapaEn(0, RECETA_DEFECTO)).toMatchObject({ etapa: "preenjuague", tE: 0 });
    expect(etapaEn(40, RECETA_DEFECTO)).toMatchObject({ etapa: "alcalino", inicioS: 40, tE: 0 });
    expect(etapaEn(299, RECETA_DEFECTO)).toMatchObject({ etapa: "desinfeccion", tE: 29 });
    expect(etapaEn(500, RECETA_DEFECTO)).toMatchObject({ etapa: "desinfeccion", tE: 30 });
  });

  it("los uplinks van cada 10 s, desfasados 5 s del inicio de cada etapa", () => {
    const u = instantesUplink(RECETA_DEFECTO);
    expect(u.slice(0, 6)).toEqual([5, 15, 25, 35, 45, 55]);
    expect(u).toContain(115);   // enjuague empieza en 110
    expect(u).toHaveLength(30);
  });
});

describe("estadoEn — determinismo", () => {
  it("el mismo t da exactamente el mismo estado, en cualquier orden de llamada", () => {
    const a = estadoEn(123.4);
    estadoEn(10); estadoEn(250);
    expect(estadoEn(123.4)).toEqual(a);
  });

  it("otra semilla cambia el ruido", () => {
    const p = { conductividadAguaRed: 150, factorCompensacionEC: 0.02, caudalNominalM3h: 18 };
    expect(estadoEn(100, RECETA_DEFECTO, "normal", { ...p, semilla: 1 }).sondas.ph)
      .not.toBe(estadoEn(100, RECETA_DEFECTO, "normal", { ...p, semilla: 2 }).sondas.ph);
  });
});

describe("estadoEn — física de planta", () => {
  const en = (t: number) => estadoEn(t).estadoProceso;

  it("temperatura y concentración de ida en las etapas químicas", () => {
    const alc = en(90).instrumentos;   // alcalino, en régimen
    expect(alc.tempIda).toBeGreaterThanOrEqual(75);
    expect(alc.tempIda).toBeLessThanOrEqual(80);
    expect(alc.concentracion).toBeGreaterThanOrEqual(1.5);
    expect(alc.concentracion).toBeLessThanOrEqual(2);
    const aci = en(190).instrumentos;  // ácido, en régimen
    expect(aci.tempIda).toBeGreaterThanOrEqual(60);
    expect(aci.tempIda).toBeLessThanOrEqual(65);
    expect(aci.concentracion).toBeGreaterThanOrEqual(0.8);
    expect(aci.concentracion).toBeLessThanOrEqual(1);
    expect(en(130).instrumentos.concentracion).toBe(0);   // enjuague
  });

  it("la presión sube con el caudal (rampa de arranque vs régimen)", () => {
    const rampa = en(41).instrumentos;   // 1 s dentro del alcalino
    const regimen = en(60).instrumentos;
    expect(rampa.caudal).toBeLessThan(regimen.caudal);
    expect(rampa.presion).toBeLessThan(regimen.presion);
    expect(regimen.caudal).toBeGreaterThan(17);
  });

  it("el estanque de soda baja al enviar y no se recupera en los enjuagues", () => {
    const antes = en(39).estanques.soda.nivel;
    const despues = en(100).estanques.soda.nivel;
    expect(despues).toBeLessThan(antes - 5);
    expect(en(140).estanques.soda.nivel).toBeCloseTo(despues, 0);
  });

  it("el estanque de ácido baja durante la etapa ácida", () => {
    expect(en(200).estanques.acido.nivel).toBeLessThan(en(140).estanques.acido.nivel - 5);
  });

  it("agua recuperada: baja en el preenjuague y el enjuague final la vuelve a llenar", () => {
    const inicio = en(0).estanques.aguaRecuperada.nivel;
    const trasPre = en(40).estanques.aguaRecuperada.nivel;
    const trasFinal = en(270).estanques.aguaRecuperada.nivel;
    expect(trasPre).toBeLessThan(inicio - 5);
    expect(trasFinal).toBeGreaterThan(trasPre + 10);
  });

  it("circuito por etapa: origen y destino del retorno", () => {
    expect(en(20).circuito).toMatchObject({ origen: "agua_recuperada", destinoRetorno: "drenaje" });
    expect(en(41).circuito.destinoRetorno).toBe("drenaje");        // empuje del agua
    expect(en(60).circuito).toMatchObject({ origen: "soda", destinoRetorno: "recirculacion" });
    expect(en(240).circuito).toMatchObject({ origen: "agua_red", destinoRetorno: "recuperacion" });
  });

  it("al terminar el ciclo la bomba queda apagada", () => {
    const fin = en(300);
    expect(fin.circuito.bomba).toEqual({ encendida: false, rpm: 0 });
    expect(fin.instrumentos.caudal).toBe(0);
    expect(fin.progresoEtapa).toBe(1);
  });

  it("los consumos crecen y quedan en unidades plausibles (m³ y litros)", () => {
    const a = estadoEn(150).consumos;
    const b = estadoEn(300).consumos;
    for (const k of ["aguaTotal", "aguaRecuperada", "soda", "acido"] as const) {
      expect(b[k]).toBeGreaterThanOrEqual(a[k]);
    }
    expect(b.soda).toBe(150);              // retención del circuito
    expect(b.acido).toBe(150);
    expect(b.aguaTotal).toBeGreaterThan(0.4);
    expect(b.aguaTotal).toBeLessThan(1);
    expect(b.aguaRecuperada).toBeGreaterThan(0.1);
  });
});

describe("estadoEn — sondas por el camino real del backend", () => {
  it("escenario normal: ningún uplink de etapas monitoreadas cruza los umbrales del seed", () => {
    expect(alertasDe("normal")).toEqual([]);
  });

  it("escenario normal: el último uplink del enjuague final cumple criterioLimpio", () => {
    const u = instantesUplink(RECETA_DEFECTO).filter((t) => etapaEn(t, RECETA_DEFECTO).etapa === "enjuague_final");
    const l = lecturaComoBackend(u[u.length - 1], RECETA_DEFECTO, "normal");
    expect(l.evaluables.conductividad25C).toBeLessThanOrEqual(PARAMS_DEFECTO.criterioLimpio.conductividad25C);
    expect(l.evaluables.turbidez).toBeLessThanOrEqual(PARAMS_DEFECTO.criterioLimpio.turbidez);
  });

  it("escenario normal: el enjuague final empieza cerca de 280 µS/cm y cruza el criterio (200) a mitad de etapa", () => {
    const etapa = RECETA_DEFECTO.find((p) => p.etapa === "enjuague_final")!;
    const inicio = etapaEn(215, RECETA_DEFECTO).inicioS;
    const u = instantesUplink(RECETA_DEFECTO).filter((t) => etapaEn(t, RECETA_DEFECTO).etapa === "enjuague_final");
    const ec = u.map((t) => lecturaComoBackend(t, RECETA_DEFECTO, "normal").evaluables.conductividad25C);
    expect(ec[0]).toBeGreaterThan(250);
    expect(ec[0]).toBeLessThan(300);   // bajo el umbral de alerta
    const cruce = u[ec.findIndex((e) => e <= PARAMS_DEFECTO.criterioLimpio.conductividad25C)] - inicio;
    expect(cruce).toBeGreaterThanOrEqual(etapa.duracionS * 0.4);
    expect(cruce).toBeLessThanOrEqual(etapa.duracionS * 0.6);
  });

  it("en los enjuagues la conductividad cae hacia el agua de red y la turbidez baja", () => {
    const u = instantesUplink(RECETA_DEFECTO).filter((t) => etapaEn(t, RECETA_DEFECTO).etapa === "enjuague");
    const ec = u.map((t) => lecturaComoBackend(t, RECETA_DEFECTO, "normal").evaluables.conductividad25C);
    const tu = u.map((t) => lecturaComoBackend(t, RECETA_DEFECTO, "normal").evaluables.turbidez);
    for (let i = 1; i < ec.length; i++) {
      expect(ec[i]).toBeLessThan(ec[i - 1]);
      expect(tu[i]).toBeLessThan(tu[i - 1]);
    }
    expect(ec[ec.length - 1]).toBeLessThan(PARAMS_DEFECTO.conductividadAguaRed * 1.5);
  });

  it("escenario falla: la conductividad no baja y se disparan alertas en el enjuague final", () => {
    const alertas = alertasDe("falla");
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertas.every((a) => a.startsWith("enjuague_final/conductividad25C"))).toBe(true);
    const u = instantesUplink(RECETA_DEFECTO).filter((t) => etapaEn(t, RECETA_DEFECTO).etapa === "enjuague_final");
    const ultima = lecturaComoBackend(u[u.length - 1], RECETA_DEFECTO, "falla");
    expect(ultima.evaluables.conductividad25C).toBeGreaterThan(PARAMS_DEFECTO.criterioLimpio.conductividad25C);
  });

  // Comportamiento aceptado: el ingest no revisa tempMaxOperacion, así que pH y
  // turbidez de las etapas químicas se guardan (PENDIENTES-DASHBOARD.md, punto 4)
  it("etapas químicas en régimen: se descartan conductividad y temperaturas de sonda; pH y turbidez se guardan", () => {
    for (const t of [95, 195]) {   // alcalino y ácido, ya en temperatura
      const l = lecturaComoBackend(t, RECETA_DEFECTO, "normal");
      expect(Object.keys(l.descartadas).sort()).toEqual(["conductividad", "tempEc", "tempSonda"]);
      expect(l.limpios.ph).toBeDefined();
      expect(l.limpios.turbidez).toBeDefined();
      expect(l.limpios.tempExterna).toBeDefined();
      expect(l.evaluables.conductividad25C).toBeUndefined();
    }
  });

  it("en las etapas monitoreadas no se descarta nada", () => {
    for (const t of instantesUplink(RECETA_DEFECTO)) {
      if (!ETAPAS_MONITOREADAS.includes(etapaEn(t, RECETA_DEFECTO).etapa)) continue;
      expect(lecturaComoBackend(t, RECETA_DEFECTO, "normal").descartadas).toEqual({});
    }
  });

  it("todas las lecturas del ciclo se pueden codificar (caben en el payload)", () => {
    for (let t = 0; t <= 300; t += 1) {
      for (const e of ["normal", "falla"] as const) expect(() => lecturaComoBackend(t, RECETA_DEFECTO, e)).not.toThrow();
    }
  });
});
