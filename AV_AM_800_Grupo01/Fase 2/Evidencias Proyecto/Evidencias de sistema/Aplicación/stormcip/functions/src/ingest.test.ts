import { describe, expect, it } from "vitest";
import { idAlerta, validarYLimpiarValores } from "./ingest";
import { Sonda } from "./types";

const SONDAS_PROYECTO: Sonda[] = [
  { modelo: "DR-PH01" },
  { modelo: "DR-ECK10.0" },
  { modelo: "DR-TS1" },
  { modelo: "DS18B20" },
];

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

  it("rechaza tempExterna numérico fuera del rango del DS18B20 (-55 a 125 °C)", () => {
    const r = validarYLimpiarValores({ tempExterna: 130 }, SONDAS_PROYECTO);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba error");
    expect(r.error).toMatch(/fuera de rango físico/);
  });
});

describe("idAlerta — determinismo para no duplicar alertas en reintentos de TTN", () => {
  it("genera el mismo ID para la misma lectura y variable (no hay emulador para probar el .set() real)", () => {
    const primero = idAlerta("0011223344556677_1741919897", "ph");
    const segundo = idAlerta("0011223344556677_1741919897", "ph");
    expect(segundo).toBe(primero);
  });

  it("genera IDs distintos para variables distintas de la misma lectura", () => {
    const idPh = idAlerta("0011223344556677_1741919897", "ph");
    const idTurbidez = idAlerta("0011223344556677_1741919897", "turbidez");
    expect(idPh).not.toBe(idTurbidez);
  });
});
