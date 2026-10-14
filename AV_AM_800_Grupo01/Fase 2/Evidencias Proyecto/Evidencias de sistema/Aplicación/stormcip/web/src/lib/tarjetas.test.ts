import { describe, expect, it } from "vitest";
import { CATALOGO_SONDAS } from "./catalogo";
import {
  ETIQUETA_SIN_COMPENSAR, causaSinCompensar, estadoTarjeta, topeDe, variablesAMostrar,
} from "./tarjetas";
import { SondaDispositivo, UltimaLecturaDispositivo } from "./tipos";

const sonda = (modelo: string, activa = true): SondaDispositivo => ({ sondaId: modelo, modelo, activa });
const EQUIPO = { ph: sonda("DR-PH01"), ec: sonda("DR-ECK1.0") };
const lectura = (p: Partial<UltimaLecturaDispositivo>): UltimaLecturaDispositivo =>
  ({ ts: null, valores: {}, ...p });
const TOPE_ECK1 = CATALOGO_SONDAS["DR-ECK1.0"].conductividad!.max;

describe("variablesAMostrar", () => {
  const vistas = ["conductividad", "conductividad25C", "ph", "tempEc", "tempSonda",
    "turbidez", "tempExterna", "arrastreQuimico"];

  it("deja solo lo que miden las sondas configuradas, en orden de proceso", () => {
    expect(variablesAMostrar(vistas, EQUIPO)).toEqual(
      ["conductividad25C", "conductividad", "tempEc", "ph", "tempSonda"]);
  });

  it("no muestra tarjetas de una sonda inactiva (configuración anterior)", () => {
    const equipo = { ph: sonda("DR-PH01"), vieja: sonda("DR-ECK10.0", false) };
    expect(variablesAMostrar(["conductividad", "tempEc", "ph"], equipo)).toEqual(["ph"]);
  });

  it("turbidez y tempExterna solo aparecen si el equipo tiene esas sondas", () => {
    const conExtras = { ...EQUIPO, ts: sonda("DR-TS1"), t: sonda("DS18B20") };
    const out = variablesAMostrar(vistas, conExtras);
    expect(out).toContain("turbidez");
    expect(out).toContain("tempExterna");
  });

  it("conductividad25C aparece junto a la conductividad aunque nunca se calculó", () => {
    expect(variablesAMostrar(["conductividad", "ph"], EQUIPO)).toEqual(
      ["conductividad25C", "conductividad", "ph"]);
  });

  it("sin sondas registradas no filtra, pero los derivados no tienen tarjeta", () => {
    expect(variablesAMostrar(["ph", "turbidez", "arrastreQuimico"], undefined))
      .toEqual(["ph", "turbidez"]);
  });

  it("sin variablesVistas no hay tarjetas", () => {
    expect(variablesAMostrar(undefined, EQUIPO)).toEqual([]);
  });
});

describe("topeDe", () => {
  it("sale de CATALOGO_SONDAS según la sonda del equipo", () => {
    expect(topeDe("conductividad", EQUIPO)).toBe(TOPE_ECK1);
    expect(topeDe("conductividad", { ec: sonda("DR-ECK10.0") }))
      .toBe(CATALOGO_SONDAS["DR-ECK10.0"].conductividad!.max);
  });
  it("undefined si el equipo no tiene esa sonda o está inactiva", () => {
    expect(topeDe("turbidez", EQUIPO)).toBeUndefined();
    expect(topeDe("conductividad", { ec: sonda("DR-ECK1.0", false) })).toBeUndefined();
  });
});

describe("estadoTarjeta", () => {
  it("normal", () => {
    const l = lectura({ valores: { ph: 7.1 }, confianza: { ph: "medido" } });
    expect(estadoTarjeta("ph", l, EQUIPO)).toEqual({ tipo: "normal", valor: 7.1 });
  });

  it("saturado: el tope sale del catálogo", () => {
    const l = lectura({ valores: { conductividad: 2000 }, confianza: { conductividad: "saturado" } });
    expect(estadoTarjeta("conductividad", l, EQUIPO)).toEqual({
      tipo: "saturado", valor: 2000, tope: TOPE_ECK1 });
  });

  it("fuera de operación conserva el valor para mostrarlo atenuado", () => {
    const l = lectura({ valores: { conductividad: 900 }, confianza: { conductividad: "fuera_de_operacion" } });
    expect(estadoTarjeta("conductividad", l, EQUIPO)).toEqual({ tipo: "fuera_operacion", valor: 900 });
  });

  it("sin dato: usa el motivo de descartadas", () => {
    const motivo = "sobre el máximo de escala (15 > 14 pH): falla de sensor";
    const l = lectura({ valores: {}, descartadas: { ph: motivo } });
    expect(estadoTarjeta("ph", l, EQUIPO)).toEqual({ tipo: "sin_dato", motivo });
  });

  it("sin dato: sensor no conectado (null) y variable ausente en la última lectura", () => {
    expect(estadoTarjeta("tempExterna", lectura({ valores: { tempExterna: null } }), EQUIPO))
      .toEqual({ tipo: "sin_dato", motivo: "sensor no conectado" });
    expect(estadoTarjeta("ph", lectura({ valores: { conductividad: 100 } }), EQUIPO))
      .toEqual({ tipo: "sin_dato", motivo: "no llegó en la última lectura" });
  });

  it("sin lectura del equipo", () => {
    expect(estadoTarjeta("ph", undefined, EQUIPO).tipo).toBe("sin_dato");
  });

  describe("conductividad25C", () => {
    it("con derivado: normal", () => {
      const l = lectura({ valores: { conductividad: 300, tempEc: 25 }, derivados: { conductividad25C: 300 } });
      expect(estadoTarjeta("conductividad25C", l, EQUIPO)).toEqual({ tipo: "normal", valor: 300 });
    });

    it("derivado saturado: cota inferior, el tope es el propio valor calculado", () => {
      const l = lectura({
        valores: { conductividad: 2000, tempEc: 20 }, derivados: { conductividad25C: 2150 },
        confianza: { conductividad25C: "saturado" },
      });
      expect(estadoTarjeta("conductividad25C", l, EQUIPO)).toEqual({ tipo: "saturado", valor: 2150, tope: 2150 });
    });

    it("sin temperatura: valor crudo, sin compensar, causa 'falta la temperatura'", () => {
      const l = lectura({ valores: { conductividad: 480 }, confianza: { conductividad: "medido" } });
      expect(estadoTarjeta("conductividad25C", l, EQUIPO)).toEqual({
        tipo: "sin_compensar", valor: 480, causa: "falta la temperatura", tope: undefined });
    });

    it("temperatura null (sensor no conectado) cuenta como falta de temperatura", () => {
      expect(causaSinCompensar(lectura({ valores: { conductividad: 480, tempEc: null } })))
        .toBe("falta la temperatura");
    });

    it("temperatura saturada / fuera de operación", () => {
      expect(causaSinCompensar(lectura({
        valores: { conductividad: 480, tempEc: 60 }, confianza: { tempEc: "saturado" },
      }))).toBe("temperatura saturada");
      expect(causaSinCompensar(lectura({
        valores: { conductividad: 480, tempEc: 70 }, confianza: { tempEc: "fuera_de_operacion" },
      }))).toBe("temperatura fuera de operación");
    });

    it("conductividad fuera de operación", () => {
      const l = lectura({
        valores: { conductividad: 480, tempEc: 70 },
        confianza: { conductividad: "fuera_de_operacion", tempEc: "fuera_de_operacion" },
      });
      expect(causaSinCompensar(l)).toBe("conductividad fuera de operación");
    });

    it("usa la misma temperatura que el backend: tempEc antes que tempSonda", () => {
      // tempEc válida y tempSonda saturada: el backend compensa con tempEc, no hay causa
      expect(causaSinCompensar(lectura({
        valores: { conductividad: 480, tempEc: 22, tempSonda: 60 }, confianza: { tempSonda: "saturado" },
      }))).toBeUndefined();
    });

    it("si la causa no se deduce de los datos, no se inventa", () => {
      const l = lectura({
        valores: { conductividad: 480, tempEc: 22 },
        confianza: { conductividad: "medido", tempEc: "medido" },
      });
      const e = estadoTarjeta("conductividad25C", l, EQUIPO);
      expect(e).toMatchObject({ tipo: "sin_compensar", valor: 480 });
      expect((e as { causa?: string }).causa).toBeUndefined();
    });

    it("sin conductividad ni derivado: sin dato con el motivo de la conductividad", () => {
      const l = lectura({ valores: {}, descartadas: { conductividad: "bajo el mínimo físico" } });
      expect(estadoTarjeta("conductividad25C", l, EQUIPO))
        .toEqual({ tipo: "sin_dato", motivo: "bajo el mínimo físico" });
    });

    it("conductividad saturada y sin temperatura: crudo con el tope del catálogo", () => {
      const l = lectura({ valores: { conductividad: 2000 }, confianza: { conductividad: "saturado" } });
      expect(estadoTarjeta("conductividad25C", l, EQUIPO))
        .toMatchObject({ tipo: "sin_compensar", valor: 2000, tope: TOPE_ECK1 });
    });
  });

  it("etiqueta fija pedida", () => expect(ETIQUETA_SIN_COMPENSAR).toBe("sin compensar a 25 °C"));
});
