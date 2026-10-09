import { describe, expect, it } from "vitest";
import { SIN_UMBRAL, estaDetenido, estadoIndicadores, formatear, formatearRango } from "./tipos";

// Marca de tiempo: en el front llega como Timestamp de Firestore, pero
// estadoIndicadores solo comprueba que exista, así que cualquier valor sirve.
const CALCULADO = { toDate: () => new Date("2026-10-01T12:00:00Z") };

describe("estadoIndicadores", () => {
  it("pendiente si el trigger no ha corrido", () => {
    expect(estadoIndicadores({}).tipo).toBe("pendiente");
    expect(estadoIndicadores(undefined).tipo).toBe("pendiente");
  });

  // Caso real: un ciclo en curso tiene indicadores de un recálculo previo, pero
  // mientras no exista la marca no hay nada nuevo que mostrar.
  it("pendiente aunque haya indicadores, si falta la marca de cálculo", () => {
    expect(estadoIndicadores({
      indicadores: { arrastreQuimico: 120 }, lecturasConsideradas: 4,
    }).tipo).toBe("pendiente");
  });

  it("sin_lecturas cuando el ciclo cerró sin lecturas monitoreadas", () => {
    expect(estadoIndicadores({
      indicadores: {}, lecturasConsideradas: 0, indicadoresCalculadosEn: CALCULADO,
    }).tipo).toBe("sin_lecturas");
  });

  // El trigger escribe lecturasConsideradas siempre, pero un ciclo calculado
  // antes de ese campo no lo tiene: se trata como 0, no como "listo".
  it("sin_lecturas si falta lecturasConsideradas", () => {
    expect(estadoIndicadores({
      indicadores: {}, indicadoresCalculadosEn: CALCULADO,
    }).tipo).toBe("sin_lecturas");
  });

  it("sin_valores cuando hubo lecturas pero ningún indicador numérico", () => {
    const e = estadoIndicadores({
      indicadores: {}, lecturasConsideradas: 7, indicadoresCalculadosEn: CALCULADO,
    });
    expect(e.tipo).toBe("sin_valores");
    expect(e).toMatchObject({ lecturas: 7 });
  });

  it("listo con las claves presentes, en orden de proceso", () => {
    const e = estadoIndicadores({
      indicadores: {
        volumenEstimado: 2.4, tiempoHastaLimpio: 420, arrastreQuimico: 980,
      },
      lecturasConsideradas: 12, indicadoresCalculadosEn: CALCULADO,
    });
    expect(e).toEqual({
      tipo: "listo",
      // el orden es el de INDICADORES_CICLO, no el del objeto de Firestore
      claves: ["tiempoHastaLimpio", "arrastreQuimico", "volumenEstimado"],
      lecturas: 12,
    });
  });

  // conductividad25C es un derivado por lectura, no un agregado del ciclo:
  // si fuera lo único presente, no hay indicadores de ciclo que mostrar.
  it("ignora derivados que no son del ciclo", () => {
    expect(estadoIndicadores({
      indicadores: { conductividad25C: 310 },
      lecturasConsideradas: 5, indicadoresCalculadosEn: CALCULADO,
    }).tipo).toBe("sin_valores");
  });

  // Un indicador puede ser 0 legítimamente (agua ya limpia en la primera
  // lectura): el filtro es por tipo, no por valor verdadero.
  it("cuenta un indicador en 0 como presente", () => {
    const e = estadoIndicadores({
      indicadores: { tiempoHastaLimpio: 0 },
      lecturasConsideradas: 3, indicadoresCalculadosEn: CALCULADO,
    });
    expect(e).toMatchObject({ tipo: "listo", claves: ["tiempoHastaLimpio"] });
  });
});

describe("formatear", () => {
  it("usa los decimales declarados por variable", () => {
    expect(formatear("tiempoHastaLimpio", 420)).toBe("420");
    expect(formatear("volumenEstimado", 2.4)).toBe("2.40");
    expect(formatear("pendienteConductividad", -51.27)).toBe("-51.3");
  });

  it("devuelve guión cuando no hay dato", () => {
    expect(formatear("volumenEstimado", undefined)).toBe("—");
    expect(formatear("volumenEstimado", null)).toBe("—");
  });
});

describe("formatearRango", () => {
  it("solo máximo", () => expect(formatearRango({ max: 3000 })).toBe("≤ 3000"));
  it("solo mínimo", () => expect(formatearRango({ min: 5 })).toBe("≥ 5"));
  it("ambos límites", () => expect(formatearRango({ min: 5, max: 11 })).toBe("5–11"));

  it("ninguno", () => {
    expect(formatearRango({})).toBe(SIN_UMBRAL);
    expect(formatearRango(undefined)).toBe("Sin umbral definido");
  });

  // Las alertas guardan el límite ausente como null, no como undefined
  it("trata null como límite ausente", () => {
    expect(formatearRango({ min: null, max: 60 })).toBe("≤ 60");
    expect(formatearRango({ min: null, max: null })).toBe(SIN_UMBRAL);
  });

  it("acepta 0 como límite válido", () => {
    expect(formatearRango({ min: 0 })).toBe("≥ 0");
    expect(formatearRango({ min: 0, max: 0 })).toBe("0–0");
  });
});

describe("estaDetenido", () => {
  const marca = (ms: number) => ({ toDate: () => new Date(ms) });
  const AHORA = Date.UTC(2026, 9, 9, 12, 0, 0);

  it("no está detenido si se actualizó hace menos de 10 s", () => {
    expect(estaDetenido(marca(AHORA - 9_000), AHORA)).toBe(false);
  });

  it("está detenido si pasaron más de 10 s", () => {
    expect(estaDetenido(marca(AHORA - 11_000), AHORA)).toBe(true);
  });

  // serverTimestamp recién escrito: el listener local lo ve null un instante
  it("null (serverTimestamp sin confirmar) cuenta como recién escrito", () => {
    expect(estaDetenido(null, AHORA)).toBe(false);
  });

  it("sin marca de tiempo se considera detenido", () => {
    expect(estaDetenido(undefined, AHORA)).toBe(true);
  });
});
