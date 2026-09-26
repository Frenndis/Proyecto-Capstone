import { describe, expect, it } from "vitest";
import { decodeWqs } from "./wqsDecoder";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

describe("FPort 5 — estado del dispositivo", () => {
  it("decodifica el ejemplo oficial del manual", () => {
    const r = decodeWqs(hexToBytes("3C010001000DC8"), 5);
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 5) throw new Error("esperaba ok fPort 5");
    expect(r.datos).toEqual({
      modelo: 0x3c,
      firmware: "1.0.0",
      banda: "EU868",
      subBanda: 0,
      bateriaV: 3.528,
    });
  });
});

describe("FPort 2 — formato antiguo (firmware < 1.2)", () => {
  it("decodifica turbidez + ORP + pH sin temperaturas", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE"), 2, "1.1");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      turbidez: 251,
      orp: 2,
      ph: 7.34,
    });
  });

  it("devuelve error si el largo no calza (2 bytes de más)", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111"), 2, "1.1");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba error");
    expect(r.error).toMatch(/formato no soportado/);
    expect(r.raw.fPort).toBe(2);
  });
});

describe("FPort 2 — formato 1.2.x (con temperatura en EC_K10, EC_K1 y pH)", () => {
  it("decodifica turbidez + ORP + pH con phTemp", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111"), 2, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      turbidez: 251,
      orp: 2,
      ph: 7.34,
      phTemp: 27.3,
    });
  });

  it("regresión: pH + EC_K10 + turbidez no debe leer ECK10_temp como pH", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2509CE03E8011102BC0111"), 2, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      turbidez: 251,
      ecK10: 10000,
      ecK10Temp: 27.3,
      ph: 7,
      phTemp: 27.3,
    });
  });

  it("oxígeno disuelto con temperatura (hipótesis con doTemp calza el largo)", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC10048B00FA"), 2, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      oxigenoDisuelto: 11.63,
      doTemp: 25,
    });
  });

  it("oxígeno disuelto sin temperatura (hipótesis sin doTemp calza el largo)", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC10048B"), 2, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      oxigenoDisuelto: 11.63,
      doTemp: null,
    });
  });

  it("ORP negativo", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC08FF9C"), 2, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      orp: -100,
    });
  });
});

describe("FPort 2 — firmware >= 1.3.1 (flag de 2 bytes no documentado)", () => {
  it("devuelve error para cualquier payload en firmware 1.3.3", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111"), 2, "1.3.3");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba error");
    expect(r.error).toMatch(/formato no soportado/);
  });

  it("devuelve error para firmware 1.3.1", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111"), 2, "1.3.1");
    expect(r.ok).toBe(false);
  });
});

describe("FPort 2 — firmware desconocido: inferir formato por largo (B primero, luego A)", () => {
  it("infiere formato B cuando el largo solo calza con B", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111"), 2);
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      turbidez: 251,
      orp: 2,
      ph: 7.34,
      phTemp: 27.3,
      formatoInferido: true,
    });
  });

  it("infiere formato A cuando el largo solo calza con A", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE"), 2);
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 2) throw new Error("esperaba ok fPort 2");
    expect(r.datos).toEqual({
      bateriaV: 3.252,
      tempExterna: null,
      turbidez: 251,
      orp: 2,
      ph: 7.34,
      formatoInferido: true,
    });
  });

  it("devuelve error si el largo no calza ni con A ni con B", () => {
    const r = decodeWqs(hexToBytes("0CB40CCC2909CE000202DE0111FFFF"), 2);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba error");
    expect(r.error).toMatch(/formato no soportado/);
  });
});

describe("FPort 3 — datalog (firmware < 1.3.3)", () => {
  it("decodifica un registro con DO + EC_K1 + pH", () => {
    const r = decodeWqs(hexToBytes("048B013E03889367D39699"), 3, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 3) throw new Error("esperaba ok fPort 3");
    expect(r.datos).toEqual([
      { oxigenoDisuelto: 11.63, ecK1: 318, ph: 9.04, sinAck: true, timestamp: 1741919897 },
    ]);
  });

  it("ignora registros de 11 bytes en cero", () => {
    const r = decodeWqs(hexToBytes("00".repeat(11)), 3, "1.2");
    expect(r.ok).toBe(true);
    if (!r.ok || r.fPort !== 3) throw new Error("esperaba ok fPort 3");
    expect(r.datos).toEqual([]);
  });

  it("devuelve error en firmware 1.3.3 (el datalog fue eliminado)", () => {
    const r = decodeWqs(hexToBytes("048B013E03889367D39699"), 3, "1.3.3");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba error");
    expect(r.error).toMatch(/formato no soportado/);
  });
});
