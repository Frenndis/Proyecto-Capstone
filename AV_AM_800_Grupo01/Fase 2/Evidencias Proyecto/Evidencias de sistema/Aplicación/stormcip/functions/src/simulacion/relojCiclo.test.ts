import { describe, expect, it } from "vitest";
import { momentoReal, planificarEspera, tiempoModelo } from "./relojCiclo";

const T0 = Date.UTC(2026, 9, 9, 15, 0, 0);
const en = (s: number) => T0 + s * 1000;

describe("planificarEspera", () => {
  it("evento en el futuro: espera lo que falta, sin pausa", () => {
    expect(planificarEspera(en(250), T0, 255, 0)).toEqual({ esperarMs: 5000, pausaS: 0, pausadoS: 0 });
  });

  it("atraso dentro de la tolerancia (≤ 5 s): se ejecuta ya, sin pausar", () => {
    expect(planificarEspera(en(258), T0, 255, 0)).toEqual({ esperarMs: 0, pausaS: 0, pausadoS: 0 });
  });

  // El caso real: el equipo se suspendió ~238 s entre dos uplinks
  it("atraso mayor a 5 s: pausa el ciclo por ese atraso", () => {
    const p = planificarEspera(en(265 + 238), T0, 265, 0);
    expect(p.esperarMs).toBe(0);
    expect(p.pausadoS).toBe(238);
    expect(p.pausaS).toBe(238);
  });

  it("tras una pausa, los eventos siguientes conservan su cadencia (no hay ráfaga)", () => {
    const tras = planificarEspera(en(265 + 238), T0, 265, 0);
    // el uplink de t=275 espera 10 s, no se envía de inmediato
    const siguiente = planificarEspera(en(265 + 238), T0, 275, tras.pausaS);
    expect(siguiente).toEqual({ esperarMs: 10_000, pausaS: 238, pausadoS: 0 });
  });

  it("las pausas se acumulan", () => {
    const p = planificarEspera(en(100 + 20 + 30), T0, 100, 20);
    expect(p.pausadoS).toBe(30);
    expect(p.pausaS).toBe(50);
  });
});

describe("tiempoModelo y momentoReal", () => {
  it("descuenta la pausa: el progreso no salta al reanudar", () => {
    expect(tiempoModelo(en(265 + 238), T0, 238, 300)).toBe(265);
  });

  it("se acota al ciclo", () => {
    expect(tiempoModelo(en(-3), T0, 0, 300)).toBe(0);
    expect(tiempoModelo(en(900), T0, 0, 300)).toBe(300);
  });

  // etapaInicio de estadoProceso usa momentoReal: se corre junto con la pausa
  it("momentoReal desplaza los instantes del modelo por la pausa", () => {
    expect(momentoReal(T0, 210, 0)).toBe(en(210));
    expect(momentoReal(T0, 210, 238)).toBe(en(448));
  });
});
