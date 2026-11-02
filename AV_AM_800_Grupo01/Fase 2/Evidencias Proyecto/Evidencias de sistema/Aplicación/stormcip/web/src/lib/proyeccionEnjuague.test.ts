import { describe, expect, it } from "vitest";
import { avisoProyeccion, formatearDuracion } from "./proyeccionEnjuague";

const EQUIPO = "wqs-lb-01";
const ciclo = (p: Record<string, unknown>, etapaActual = "enjuague_final") => ({
  etapaActual,
  proyeccionEnjuague: { [EQUIPO]: { etapa: "enjuague_final", muestras: 8, ...p } as never },
});

describe("formatearDuracion", () => {
  it("usa segundos bajo un minuto y minutos desde ahí", () => {
    expect(formatearDuracion(45)).toBe("45 s");
    expect(formatearDuracion(60)).toBe("1 min");
    expect(formatearDuracion(660)).toBe("11 min");
  });
});

describe("avisoProyeccion", () => {
  it("una proyección muestra el plazo, el intervalo y se marca como estimada", () => {
    const a = avisoProyeccion(ciclo({
      estado: "proyectando", restanteS: 660, restanteMinS: 480, restanteMaxS: 840, metodo: "caída exponencial",
    }), EQUIPO, true);
    expect(a?.tono).toBe("estimado");
    expect(a?.titulo).toBe("≈ 11 min para agua limpia");
    expect(a?.detalle).toContain("entre 8 min y 14 min");
    expect(a?.detalle).toContain("caída exponencial");
  });

  it("cuando ya cumple, lo dice sin insinuar que la etapa se acorta sola", () => {
    const a = avisoProyeccion(ciclo({ estado: "limpio" }), EQUIPO, true);
    expect(a?.tono).toBe("listo");
    expect(a?.detalle).toContain("no cambia automáticamente");
  });

  it("si no converge, avisa y no muestra ningún plazo", () => {
    const a = avisoProyeccion(ciclo({ estado: "no_converge" }), EQUIPO, true);
    expect(a?.tono).toBe("alerta");
    expect(a?.titulo).not.toMatch(/\d/);
  });

  it("con pocas lecturas, indica que está reuniendo datos", () => {
    expect(avisoProyeccion(ciclo({ estado: "datos_insuficientes" }), EQUIPO, true)?.titulo).toBe("Reuniendo lecturas");
  });

  it("no muestra una proyección de otra etapa", () => {
    expect(avisoProyeccion(ciclo({ estado: "limpio" }, "desinfeccion"), EQUIPO, true)).toBeNull();
  });

  it("no muestra nada en un ciclo cerrado, sin proyección o sin equipo", () => {
    expect(avisoProyeccion(ciclo({ estado: "limpio" }), EQUIPO, false)).toBeNull();
    expect(avisoProyeccion({ etapaActual: "enjuague" }, EQUIPO, true)).toBeNull();
    expect(avisoProyeccion(ciclo({ estado: "limpio" }), undefined, true)).toBeNull();
    expect(avisoProyeccion(null, EQUIPO, true)).toBeNull();
  });
});
