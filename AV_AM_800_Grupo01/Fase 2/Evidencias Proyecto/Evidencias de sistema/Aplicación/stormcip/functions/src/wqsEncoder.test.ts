import { describe, expect, it } from "vitest";
import { encodeWqsFPort2, DatosWqsFPort2 } from "./wqsEncoder";
import { bytesToHex, decodeWqs } from "./wqsDecoder";

// Decodifica con el firmware real del proyecto (1.2 → formato B)
function idaYVuelta(d: DatosWqsFPort2) {
  const r = decodeWqs(encodeWqsFPort2(d), 2, "1.2");
  if (!r.ok || r.fPort !== 2) throw new Error(`no decodificó: ${JSON.stringify(r)}`);
  return r.datos;
}

describe("encodeWqsFPort2 — inverso de decodeWqs (FPort 2, formato B)", () => {
  // Mismo payload que simulador-ttn.js y wqsDecoder.test.ts
  it("reproduce byte a byte el payload conocido del proyecto", () => {
    const bytes = encodeWqsFPort2({
      bateriaV: 3.252, tempExterna: null, turbidez: 251.0,
      ecK10: 10000, ecK10Temp: 27.3, ph: 7.0, phTemp: 27.3,
    });
    expect(bytesToHex(bytes).toUpperCase()).toBe("0CB40CCC2509CE03E8011102BC0111");
  });

  it("ida y vuelta con todas las sondas", () => {
    const d = {
      bateriaV: 3.6, tempExterna: 21.4, turbidez: 12.3,
      ecK10: 1450, ecK10Temp: 24.6, ph: 7.65, phTemp: 24.8,
    };
    expect(idaYVuelta(d)).toEqual(d);
  });

  it("DS18B20 desconectado: null ida y vuelta (centinela 0x0CCC)", () => {
    const datos = idaYVuelta({
      bateriaV: 3.6, tempExterna: null, turbidez: 5, ecK10: 200, ecK10Temp: 20, ph: 7, phTemp: 20,
    });
    expect(datos.tempExterna).toBeNull();
  });

  it("temperaturas negativas usan complemento a dos", () => {
    const datos = idaYVuelta({
      bateriaV: 3.6, tempExterna: -5.5, ecK10: 300, ecK10Temp: -2.1, ph: 7, phTemp: -1.0,
    });
    expect(datos.tempExterna).toBe(-5.5);
    expect(datos.ecK10Temp).toBe(-2.1);
  });

  // Mismas escalas que el decoder: EC en pasos de 10 µS/cm, pH en 0,01
  it("cuantiza con la resolución del equipo", () => {
    const datos = idaYVuelta({
      bateriaV: 3.6, tempExterna: 20, ecK10: 1234, ecK10Temp: 20, ph: 7.004, phTemp: 20,
    });
    expect(datos.ecK10).toBe(1230);
    expect(datos.ph).toBe(7);
  });

  it("conductividad de soda (~90 000 µS/cm) cabe en 16 bits gracias a la escala ×10", () => {
    expect(idaYVuelta({
      bateriaV: 3.6, tempExterna: 72, ecK10: 90000, ecK10Temp: 72, ph: 13, phTemp: 72,
    }).ecK10).toBe(90000);
  });

  it("rechaza valores que no caben en 16 bits", () => {
    expect(() => encodeWqsFPort2({ bateriaV: 3.6, tempExterna: 20, turbidez: 7000 })).toThrow(/turbidez/);
  });

  it("exige la temperatura de EC y pH (obligatoria en formato B)", () => {
    expect(() => encodeWqsFPort2({ bateriaV: 3.6, tempExterna: 20, ph: 7 })).toThrow(/phTemp/);
  });
});
