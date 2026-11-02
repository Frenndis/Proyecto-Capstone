import { describe, expect, it } from "vitest";
import { HISTORIAL_VACIO, MAX_MUESTRAS, agregarMuestra } from "./historialPlanta";
import type { EstadoProceso } from "./tipos";

const planta = (ms: number | null, conc = 1.8, cicloId = "C1", etapa = "alcalino") =>
  ({
    cicloId, etapa, actualizadoEn: ms === null ? null : { toDate: () => new Date(ms) },
    instrumentos: { concentracion: conc },
  }) as unknown as EstadoProceso;

describe("agregarMuestra", () => {
  it("agrega muestras con forma de lectura, en orden", () => {
    let h = agregarMuestra(HISTORIAL_VACIO, "C1", planta(1000, 1.7));
    h = agregarMuestra(h, "C1", planta(3000, 1.9));
    expect(h.lecturas.map((l) => l.valores.concentracion)).toEqual([1.7, 1.9]);
    expect(h.lecturas[0].etapa).toBe("alcalino");
    expect(h.lecturas[1].ts.toDate().getTime()).toBe(3000);
  });

  it("ignora una muestra repetida o anterior y devuelve el mismo objeto", () => {
    const h = agregarMuestra(HISTORIAL_VACIO, "C1", planta(3000));
    expect(agregarMuestra(h, "C1", planta(3000))).toBe(h);
    expect(agregarMuestra(h, "C1", planta(2000))).toBe(h);
  });

  it("espera la hora confirmada: un serverTimestamp pendiente (null) no suma", () => {
    const h = agregarMuestra(HISTORIAL_VACIO, "C1", planta(1000));
    expect(agregarMuestra(h, "C1", planta(null))).toBe(h);
  });

  it("reinicia al cambiar de ciclo", () => {
    const h = agregarMuestra(HISTORIAL_VACIO, "C1", planta(1000));
    const otro = agregarMuestra(h, "C2", planta(500, 1.8, "C2"));
    expect(otro.cicloId).toBe("C2");
    expect(otro.lecturas).toHaveLength(1);
    // Sin datos del ciclo nuevo, queda vacío en vez de arrastrar el anterior
    expect(agregarMuestra(h, "C2", null).lecturas).toHaveLength(0);
  });

  it("no pasa del tope de muestras", () => {
    let h = HISTORIAL_VACIO;
    for (let i = 1; i <= MAX_MUESTRAS + 5; i++) h = agregarMuestra(h, "C1", planta(i * 1000));
    expect(h.lecturas).toHaveLength(MAX_MUESTRAS);
    expect(h.lecturas[0].ts.toDate().getTime()).toBe(6000);
  });
});
