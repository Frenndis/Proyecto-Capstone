import { describe, expect, it } from "vitest";
import { idAlerta, validarYLimpiarValores } from "./ingest";
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
