import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { camposAlerta, idAlerta, planificarEscritura, validarYLimpiarValores } from "./ingest";
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

  // Cambio de criterio respecto de v1: un valor fuera de rango descarta ESA
  // variable, no la lectura entera. Lo que midieron las otras sondas se guarda.
  it("descarta tempExterna fuera del rango del DS18B20 (-55 a 125 °C) y conserva el resto", () => {
    const r = validarYLimpiarValores({ ph: 7.0, tempExterna: 130 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.limpios.tempExterna).toBeUndefined();
    expect(r.limpios.ph).toBe(7.0);
    expect(r.descartadas.tempExterna).toMatch(/fuera de rango físico/);
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
