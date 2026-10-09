import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  alertasDeLectura, camposAlerta, idAlerta, planificarEscritura, validarYLimpiarValores,
  variablesVistasDe,
} from "./ingest";
import { Sonda } from "./types";

// Mapa (no array): el modelo v2 permite marcar una sonda como inactiva
const SONDAS_PROYECTO: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",    activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK10.0", activa: true },
  s3: { sondaId: "s3", modelo: "DR-TS1",     activa: true },
  s4: { sondaId: "s4", modelo: "DS18B20",    activa: true },
};

describe("validarYLimpiarValores — tempExterna (DS18B20)", () => {
  it("acepta tempExterna null (sensor no conectado) sin rechazar la lectura", () => {
    const r = validarYLimpiarValores({ ph: 7.0, tempExterna: null }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempExterna).toBeNull();
    expect(r.limpios.ph).toBe(7.0);
  });

  it("acepta tempExterna numérico dentro del rango del DS18B20", () => {
    const r = validarYLimpiarValores({ tempExterna: 25 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempExterna).toBe(25);
  });

  // El DS18B20 no satura (satura: false): sobre 125 °C es falla del chip
  it("descarta tempExterna sobre el máximo del DS18B20 (125 °C) y conserva el resto", () => {
    const r = validarYLimpiarValores({ ph: 7.0, tempExterna: 130 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempExterna).toBeUndefined();
    expect(r.limpios.ph).toBe(7.0);
    expect(r.descartadas.tempExterna).toMatch(/sobre el máximo de escala \(130 > 125 °C\)/);
  });

  // Un valor bajo el mínimo descarta ESA variable, no la lectura entera
  it("descarta tempExterna bajo el mínimo del DS18B20 (-55 °C) y conserva el resto", () => {
    const r = validarYLimpiarValores({ ph: 7.0, tempExterna: -60 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempExterna).toBeUndefined();
    expect(r.limpios.ph).toBe(7.0);
    expect(r.descartadas.tempExterna).toMatch(/bajo el mínimo físico \(-60 < -55 °C\)/);
  });

  it("descarta una variable sin sonda activa que la mida", () => {
    const r = validarYLimpiarValores({ ph: 7.0, orp: 300 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.orp).toBeUndefined();
    expect(r.descartadas.orp).toMatch(/sonda activa/);
  });

  it("rechaza la lectura solo si no queda ninguna variable válida", () => {
    const r = validarYLimpiarValores({ orp: 300 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(false);
  });
});

describe("validarYLimpiarValores — temperaturas separadas por origen", () => {
  it("acepta tempSonda y tempEc como variables distintas", () => {
    const r = validarYLimpiarValores({ tempSonda: 38, tempEc: 34.2 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempSonda).toBe(38);
    expect(r.limpios.tempEc).toBe(34.2);
  });
});

// Equipo comprado: DR-PH01 + DR-ECK1.0, sin turbidez ni DS18B20
const SONDAS_COMPRADAS: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
};

const validar = (valores: Record<string, unknown>, sondas = SONDAS_COMPRADAS) => {
  const r = validarYLimpiarValores(valores, sondas);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("validarYLimpiarValores — saturación (DR-ECK1.0, 0–2000 µS/cm)", () => {
  it("sobre el máximo guarda el tope con confianza saturado", () => {
    const r = validar({ conductividad: 2971, tempEc: 43.2 });
    expect(r.limpios.conductividad).toBe(2000);
    expect(r.confianza.conductividad).toBe("saturado");
    expect(r.confianza.tempEc).toBe("medido");
  });

  // Una sonda que topa reporta justo su máximo: no se distingue de "más"
  it("justo en el máximo también cuenta como saturado", () => {
    expect(validar({ conductividad: 2000, tempEc: 30 }).confianza.conductividad).toBe("saturado");
    expect(validar({ conductividad: 1999, tempEc: 30 }).confianza.conductividad).toBe("medido");
  });

  it("bajo el mínimo se descarta con el valor y el mínimo en el motivo", () => {
    const r = validar({ ph: -0.5, tempSonda: 20, conductividad: 300, tempEc: 20 });
    expect(r.limpios.ph).toBeUndefined();
    expect(r.descartadas.ph).toBe("bajo el mínimo físico (-0.5 < 0 pH): falla de sensor");
    expect(r.limpios.conductividad).toBe(300);
  });

  // 0–14 es la escala del pH, no un rango de medición: fuera de ella es falla
  it("el pH no satura: sobre 14 se descarta como falla de sensor; 14 justo es válido", () => {
    const r = validar({ ph: 15.5, tempSonda: 27.3 });
    expect(r.limpios.ph).toBeUndefined();
    expect(r.confianza.ph).toBeUndefined();
    expect(r.descartadas.ph).toBe("sobre el máximo de escala (15.5 > 14 pH): falla de sensor");
    const tope = validar({ ph: 14, tempSonda: 27.3 });
    expect(tope.limpios.ph).toBe(14);
    expect(tope.confianza.ph).toBe("medido");
  });

  it("las temperaturas de sonda sí saturan (tempSonda y tempEc topan en 60 °C)", () => {
    const r = validar({ ph: 13, tempSonda: 75.6, conductividad: 900, tempEc: 76 });
    expect(r.limpios.tempSonda).toBe(60);
    expect(r.confianza.tempSonda).toBe("saturado");
    expect(r.limpios.tempEc).toBe(60);
    expect(r.confianza.tempEc).toBe("saturado");
  });

  it("una variable sin sonda en el equipo comprado (turbidez) se descarta", () => {
    const r = validar({ ph: 7, tempSonda: 20, turbidez: 12 });
    expect(r.descartadas.turbidez).toMatch(/sonda activa/);
  });
});

describe("validarYLimpiarValores — temperatura máxima de operación (60 °C)", () => {
  it("con la temperatura de la propia sonda sobre 60 °C la variable queda fuera de operación", () => {
    const r = validar({ ph: 13.1, tempSonda: 59, conductividad: 1800, tempEc: 61 });
    expect(r.confianza.conductividad).toBe("fuera_de_operacion");
    expect(r.confianza.ph).toBe("medido");     // su sonda (tempSonda) está bajo 60
  });

  // tempEc 76 °C llega como 60 saturado: no se sabe cuánto mide, solo que ≥ 60
  it("temperatura saturada: fuera de operación aunque el valor guardado sea 60", () => {
    const r = validar({ ph: 13.2, tempSonda: 75.6, conductividad: 65535, tempEc: 76 });
    expect(r.limpios.tempEc).toBe(60);
    expect(r.confianza.tempEc).toBe("saturado");
    expect(r.confianza.tempSonda).toBe("saturado");
    // fuera de operación prevalece sobre saturado
    expect(r.limpios.conductividad).toBe(2000);
    expect(r.confianza.conductividad).toBe("fuera_de_operacion");
    expect(r.confianza.ph).toBe("fuera_de_operacion");
  });

  it("justo en 60 °C sigue en operación… salvo que sea el tope de la temperatura (saturada)", () => {
    // tempEc tiene max 60: un 60 es saturado y por lo tanto no se sabe si está bajo el límite
    expect(validar({ conductividad: 500, tempEc: 60 }).confianza.conductividad).toBe("fuera_de_operacion");
    expect(validar({ conductividad: 500, tempEc: 59.9 }).confianza.conductividad).toBe("medido");
  });

  // DR-TS1 no mide temperatura: se usa la mayor del líquido disponible
  it("turbidez (sin temperatura propia) usa la mayor temperatura del líquido", () => {
    const r = validar({ turbidez: 5, tempEc: 45, tempExterna: 30 }, SONDAS_PROYECTO);
    expect(r.confianza.turbidez).toBe("fuera_de_operacion");   // 45 > 40
    expect(validar({ turbidez: 5, tempEc: 35 }, SONDAS_PROYECTO).confianza.turbidez).toBe("medido");
  });

  it("sin temperatura medida no se puede evaluar: queda medido", () => {
    expect(validar({ conductividad: 500 }).confianza.conductividad).toBe("medido");
  });
});

describe("alertasDeLectura — umbral y saturación como alertas separadas", () => {
  const RANGOS = { conductividad25C: { max: 1500 }, ph: { min: 5, max: 11 } };

  it("conductividad saturada en una etapa monitoreada: alerta de saturación y de umbral", () => {
    const a = alertasDeLectura({
      etapa: "enjuague",
      numericos: { conductividad: 2000, tempEc: 43.2, ph: 8.9 },
      derivados: { conductividad25C: 1466.3 },
      confianza: { conductividad: "saturado", tempEc: "medido", ph: "medido", conductividad25C: "saturado" },
      rangos: { conductividad25C: { max: 1400 } },
      sondas: SONDAS_COMPRADAS,
    });
    expect(a.map((x) => x.clave).sort()).toEqual(["conductividad25C", "conductividad_saturacion"]);
    const sat = a.find((x) => x.tipo === "saturacion")!;
    expect(sat).toMatchObject({ variable: "conductividad", valor: 2000, min: null, max: 2000 });
    const umbral = a.find((x) => x.tipo === "umbral")!;
    expect(umbral).toMatchObject({ variable: "conductividad25C", confianza: "saturado", max: 1400 });
  });

  // Saturado = cota inferior: puede violar un máximo con certeza, nunca un mínimo
  it("un derivado saturado bajo el máximo no dispara el umbral", () => {
    const a = alertasDeLectura({
      etapa: "enjuague", numericos: {}, derivados: { conductividad25C: 1466.3 },
      confianza: { conductividad25C: "saturado" },
      rangos: { conductividad25C: { min: 1480, max: 1500 } }, sondas: SONDAS_COMPRADAS,
    });
    expect(a).toEqual([]);
  });

  it("lo fuera de operación no dispara umbrales", () => {
    const a = alertasDeLectura({
      etapa: "enjuague", numericos: { ph: 13 }, derivados: {},
      confianza: { ph: "fuera_de_operacion" }, rangos: RANGOS, sondas: SONDAS_COMPRADAS,
    });
    expect(a).toEqual([]);
  });

  it("en etapas químicas no hay alerta de saturación", () => {
    const a = alertasDeLectura({
      etapa: "alcalino", numericos: { conductividad: 2000 }, derivados: {},
      confianza: { conductividad: "fuera_de_operacion" }, rangos: {}, sondas: SONDAS_COMPRADAS,
    });
    expect(a).toEqual([]);
  });

  it("umbral normal sobre un valor medido", () => {
    const a = alertasDeLectura({
      etapa: "enjuague_final", numericos: { ph: 4.2 }, derivados: {},
      confianza: { ph: "medido" }, rangos: RANGOS, sondas: SONDAS_COMPRADAS,
    });
    expect(a).toEqual([{
      clave: "ph", variable: "ph", tipo: "umbral", valor: 4.2, confianza: "medido", min: 5, max: 11,
    }]);
  });
});

describe("variablesVistasDe — tarjetas estables en el dashboard", () => {
  it("incluye medidas, derivados y descartadas por valor inválido; no las null ni las sin sonda", () => {
    const vistas = variablesVistasDe(
      { conductividad: 300, tempEc: 20, tempExterna: null },
      { conductividad25C: 316 },
      { ph: "bajo el mínimo físico (-0.5 < 0 pH): falla de sensor", turbidez: "el equipo no tiene una sonda activa para esta variable" },
      SONDAS_COMPRADAS,
    );
    expect(vistas).toEqual(["conductividad", "conductividad25C", "ph", "tempEc"]);
  });
});

describe("idAlerta — una alerta por ciclo+etapa+variable", () => {
  it("genera el mismo ID mientras la condición persiste en la misma etapa", () => {
    expect(idAlerta("CIP-2026-0001", "enjuague", "ph"))
      .toBe(idAlerta("CIP-2026-0001", "enjuague", "ph"));
  });

  it("separa por variable y por etapa", () => {
    const a = idAlerta("CIP-2026-0001", "enjuague", "ph");
    expect(a).not.toBe(idAlerta("CIP-2026-0001", "enjuague", "turbidez"));
    expect(a).not.toBe(idAlerta("CIP-2026-0001", "enjuague_final", "ph"));
  });
});

// Minutos desde una hora fija: basta para comparar el orden de las lecturas
const t = (min: number) => Timestamp.fromMillis(Date.UTC(2026, 9, 6, 14, min, 0));

describe("camposAlerta — fechas de la alerta con el reloj de la lectura", () => {
  it("una alerta nueva parte con desde = hasta = ts de la lectura", () => {
    const r = camposAlerta(undefined, t(0), 4.1);
    expect(r.nuevoEpisodio).toBe(true);
    expect(r.campos).toEqual({ desde: t(0), hasta: t(0), ultimoValor: 4.1, conteo: 1, reconocida: false });
  });

  // El caso del pendiente: antes `desde` se pisaba en cada repetición
  it("dos lecturas fuera de rango seguidas no cambian desde, pero sí actualizan hasta", () => {
    const primera = camposAlerta(undefined, t(0), 4.1).campos;
    const r = camposAlerta({ ...primera }, t(5), 3.9);
    expect(r.nuevoEpisodio).toBe(false);
    expect(r.campos.desde).toEqual(t(0));
    expect(r.campos.hasta).toEqual(t(5));
    expect(r.campos.ultimoValor).toBe(3.9);
    expect(r.campos.conteo).toBe(2);
  });

  it("no escribe reconocida en una alerta activa (la deja como está)", () => {
    const r = camposAlerta({ desde: t(0), hasta: t(0), conteo: 1, reconocida: false }, t(5), 3.9);
    expect(r.campos).not.toHaveProperty("reconocida");
  });

  // Reintento de TTN o simulador que fecha hacia atrás
  it("una lectura atrasada no retrocede hasta ni cambia ultimoValor, pero sí adelanta desde", () => {
    const existente = { desde: t(10), hasta: t(20), conteo: 3, reconocida: false };
    const r = camposAlerta(existente, t(5), 9.9);
    expect(r.campos.desde).toEqual(t(5));
    expect(r.campos.hasta).toEqual(t(20));
    expect(r.campos).not.toHaveProperty("ultimoValor");
    expect(r.campos.conteo).toBe(4);
  });

  it("una lectura entre desde y hasta no mueve ninguno de los dos", () => {
    const r = camposAlerta({ desde: t(10), hasta: t(20), conteo: 2, reconocida: false }, t(15), 9.9);
    expect(r.campos.desde).toEqual(t(10));
    expect(r.campos.hasta).toEqual(t(20));
    expect(r.campos).not.toHaveProperty("ultimoValor");
  });

  it("con ts igual a hasta sí actualiza ultimoValor", () => {
    const r = camposAlerta({ desde: t(10), hasta: t(20), conteo: 2, reconocida: false }, t(20), 9.9);
    expect(r.campos.ultimoValor).toBe(9.9);
  });

  it("una alerta reconocida que reaparece es un episodio nuevo", () => {
    const existente = { desde: t(0), hasta: t(10), conteo: 7, reconocida: true };
    const r = camposAlerta(existente, t(30), 4.0);
    expect(r.nuevoEpisodio).toBe(true);
    expect(r.campos).toEqual({ desde: t(30), hasta: t(30), ultimoValor: 4.0, conteo: 1, reconocida: false });
  });
});

describe("planificarEscritura — reintentos con ID determinista", () => {
  const eventos = [{ id: "CIP-1_enjuague_ph", valor: 4.1 }];

  it("si la lectura ya existe es un duplicado y no planifica ninguna escritura", () => {
    expect(planificarEscritura(true, eventos, t(0))).toEqual({ duplicado: true });
  });

  it("si la lectura es nueva planifica una escritura por alerta disparada", () => {
    const plan = planificarEscritura(false, eventos, t(0));
    expect(plan.duplicado).toBe(false);
    if (plan.duplicado) throw new Error("esperaba plan de escritura");
    expect(plan.alertas).toHaveLength(1);
    expect(plan.alertas[0].id).toBe("CIP-1_enjuague_ph");
    expect(plan.alertas[0].campos.conteo).toBe(1);
  });
});

describe("planificarEscritura — ultimaLectura solo avanza", () => {
  it("sin ultimaLectura guardada, la lectura pasa a ser la última", () => {
    const plan = planificarEscritura(false, [], t(10));
    expect(plan).toMatchObject({ duplicado: false, actualizarUltima: true });
  });

  it("una lectura más nueva reemplaza la última", () => {
    expect(planificarEscritura(false, [], t(10), t(5))).toMatchObject({ actualizarUltima: true });
  });

  // Reintento de TTN o datalog: se guarda en lecturas, pero no pisa la última
  it("una lectura atrasada no reemplaza la última, aunque sí planifica sus alertas", () => {
    const plan = planificarEscritura(false, [{ id: "CIP-1_enjuague_ph", valor: 4.1 }], t(5), t(10));
    expect(plan.duplicado).toBe(false);
    if (plan.duplicado) throw new Error("esperaba plan de escritura");
    expect(plan.actualizarUltima).toBe(false);
    expect(plan.alertas).toHaveLength(1);
  });

  it("con el mismo ts sí reemplaza (reenvío de la misma lectura)", () => {
    expect(planificarEscritura(false, [], t(10), t(10))).toMatchObject({ actualizarUltima: true });
  });
});
