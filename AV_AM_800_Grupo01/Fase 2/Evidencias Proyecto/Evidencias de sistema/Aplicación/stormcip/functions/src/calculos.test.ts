import { describe, expect, it } from "vitest";
import { derivarLectura } from "./calculos";
import { PARAMS_DEFECTO } from "./types";

describe("derivarLectura — conductividad25C con sonda saturada o fuera de operación", () => {
  it("valores medidos: EC25 medida", () => {
    const d = derivarLectura({ conductividad: 1450, tempEc: 43.2 }, PARAMS_DEFECTO,
      { conductividad: "medido", tempEc: "medido" });
    expect(d.derivados.conductividad25C).toBeCloseTo(1063.0, 0);
    expect(d.confianza.conductividad25C).toBe("medido");
  });

  // El EC real es ≥ 2000, así que EC25 real es ≥ 2000 / factor
  it("conductividad saturada con temperatura válida: EC25 es cota inferior", () => {
    const d = derivarLectura({ conductividad: 2000, tempEc: 43.2 }, PARAMS_DEFECTO,
      { conductividad: "saturado", tempEc: "medido" });
    expect(d.derivados.conductividad25C).toBeCloseTo(1466.3, 1);
    expect(d.confianza.conductividad25C).toBe("saturado");
    expect(d.metodo.conductividad25C).toMatch(/cota inferior/);
  });

  it("temperatura saturada: no se calcula EC25", () => {
    const d = derivarLectura({ conductividad: 1200, tempEc: 60 }, PARAMS_DEFECTO,
      { conductividad: "medido", tempEc: "saturado" });
    expect(d.derivados.conductividad25C).toBeUndefined();
  });

  it("conductividad fuera de operación: no se calcula EC25", () => {
    const d = derivarLectura({ conductividad: 2000, tempEc: 59 }, PARAMS_DEFECTO,
      { conductividad: "fuera_de_operacion", tempEc: "medido" });
    expect(d.derivados.conductividad25C).toBeUndefined();
  });

  it("sin confianza (ingest HTTP legado sin sondas) se comporta como antes", () => {
    const d = derivarLectura({ conductividad: 1000, tempEc: 25 }, PARAMS_DEFECTO);
    expect(d.derivados.conductividad25C).toBe(1000);
    expect(d.confianza.conductividad25C).toBe("medido");
  });
});
