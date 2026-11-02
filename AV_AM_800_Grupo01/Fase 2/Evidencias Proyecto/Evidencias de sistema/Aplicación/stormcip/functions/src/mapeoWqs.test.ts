import { describe, expect, it } from "vitest";
import { mapearAValores } from "./mapeoWqs";
import { decodeWqs } from "./wqsDecoder";
import { encodeWqsFPort2 } from "./wqsEncoder";
import { Sonda } from "./types";

const COMPRADAS: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
};
const CON_ECK10: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",    activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK10.0", activa: true },
};

/** Payload real (formato B) → campos del decoder. */
function decodificar(d: Parameters<typeof encodeWqsFPort2>[0]) {
  const r = decodeWqs(encodeWqsFPort2(d), 2, "1.2");
  if (!r.ok || r.fPort !== 2) throw new Error("no decodificó");
  return r.datos;
}

describe("mapearAValores — DR-ECK1.0 (equipo comprado)", () => {
  it("ecK1 → conductividad y ecK1Temp → tempEc", () => {
    const v = mapearAValores(decodificar({
      bateriaV: 3.6, tempExterna: null, ecK1: 1450, ecK1Temp: 43.2, ph: 8.9, phTemp: 42.9,
    }), COMPRADAS);
    expect(v).toEqual({
      conductividad: 1450, tempEc: 43.2, ph: 8.9, tempSonda: 42.9, tempExterna: null,
    });
  });

  // Ejemplo del manual (datalog): 0x013E = 318 µS/cm, sin divisor
  it("ECK1 se toma sin divisor: 318 llega como 318", () => {
    const datos = decodificar({ bateriaV: 3.6, tempExterna: null, ecK1: 318, ecK1Temp: 20 });
    expect(datos.ecK1).toBe(318);
    expect(mapearAValores(datos, COMPRADAS).conductividad).toBe(318);
  });

  it("con las dos conductividades en el payload usa la de la sonda declarada", () => {
    const datos = decodificar({
      bateriaV: 3.6, tempExterna: null,
      ecK10: 5000, ecK10Temp: 30, ecK1: 2000, ecK1Temp: 31,
    });
    expect(mapearAValores(datos, COMPRADAS)).toMatchObject({ conductividad: 2000, tempEc: 31 });
    expect(mapearAValores(datos, CON_ECK10)).toMatchObject({ conductividad: 5000, tempEc: 30 });
  });

  it("DR-ECK10.0 sigue funcionando para un equipo que la tenga", () => {
    const v = mapearAValores(decodificar({
      bateriaV: 3.6, tempExterna: 21, ecK10: 1450, ecK10Temp: 24.6,
    }), CON_ECK10);
    expect(v).toEqual({ conductividad: 1450, tempEc: 24.6, tempExterna: 21 });
  });
});
