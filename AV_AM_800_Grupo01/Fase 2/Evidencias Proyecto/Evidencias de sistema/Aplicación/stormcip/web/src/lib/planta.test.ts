import { describe, expect, it } from "vitest";
import {
  CicloPlanta, FaseCiclo, PuntoCurva, aguaPorCircuito, aguaPorDia, aviso, estadoCiclo, faseEn, inicioFase, mmss,
  periodo, programadosEn, resumenDia, semanas, tact, variacion,
} from "./planta";

const soda: FaseCiclo = { n: "Soda", etapa: "alcalino", s: 450, sReceta: 450, t: 70, c: 1.3, q: 26, min: 65, enjuague: false };
const enj: FaseCiclo = { n: "Enjuague final", etapa: "enjuague_final", s: 150, sReceta: 150, t: 30, c: 0, q: 24, min: null, enjuague: true };
const p = (o: Partial<PuntoCurva>): PuntoCurva => ({ t: 0, T: 70, c: 1.3, q: 26, ec: 500, a: 0, k: 0, ...o });
const ts = (d: Date) => ({ toDate: () => d });
const HOY = new Date(2026, 10, 2, 12);
const ciclo = (o: Partial<CicloPlanta> & { dias?: number; agua?: number; val?: "validado" | "desvio" | "fuera" }) => ({
  id: "x", estado: "finalizado", circuito: "Silo 3", inicio: ts(new Date(HOY.getTime() - (o.dias ?? 0) * 86400000)),
  resumen: { aguaL: o.agua ?? 1000, quimicoL: 10, duracionS: 3600, validacion: o.val ?? "validado", tempMinSoda: null, fases: [] }, ...o,
} as unknown as CicloPlanta);

describe("tact", () => {
  it("todo en rango durante la soda", () => {
    const f = tact(soda, p({}), 200);
    expect(f[0].estado).toBe("ok");
    expect(f[1].valor).toContain("m/s");
    expect(f[2].estado).toBe("ok");
    expect(f[3].valor).toBe("03:20 de 07:30");
  });
  it("bajo el mínimo ya caliente es desvío y pausa el conteo", () => {
    const f = tact(soda, p({ T: 60 }), 300);
    expect(f[0].estado).toBe("warn");
    expect(f[3].valor).toBe("conteo en pausa");
  });
  it("mientras calienta no es desvío", () => {
    expect(tact(soda, p({ T: 50 }), 30)[0].estado).toBe("wait");
  });
  it("en un enjuague la concentración es conductividad y agua limpia", () => {
    expect(tact(enj, p({ T: 30, c: 0, ec: 180 }), 90)[2].valor).toContain("180 µS/cm");
  });
});

describe("aviso", () => {
  const c = { numero: "CIP-1", resumen: undefined };
  it("explica la fase en curso", () => {
    expect(aviso(soda, p({}), 200, false, c)).toEqual({ tono: "info", texto: "Fase «Soda»: objetivo 70 °C · 1,3 %" });
  });
  it("avisa el desvío", () => {
    expect(aviso(soda, p({ T: 60 }), 300, false, c).tono).toBe("warn");
  });
  it("dice cuándo el enjuague ya está limpio", () => {
    expect(aviso(enj, p({ ec: 190 }), 90, false, c).texto).toContain("ya no limpia nada");
  });
  it("al cerrar emite el registro según su resultado", () => {
    expect(aviso(soda, p({}), 0, true, { numero: "CIP-1", resumen: { validacion: "fuera" } as never }).tono).toBe("crit");
    expect(aviso(soda, p({}), 0, true, c).texto).toBe("Ciclo validado. Registro CIP-1 emitido.");
  });
});

describe("estadoCiclo y resumenDia", () => {
  it("nombra cada estado", () => {
    expect(estadoCiclo(undefined).tono).toBe("idle");
    expect(estadoCiclo(ciclo({ estado: "en_curso" })).texto).toBe("En curso");
    expect(estadoCiclo(ciclo({ val: "desvio" })).tono).toBe("warn");
    expect(estadoCiclo(ciclo({ val: "fuera" })).tono).toBe("crit");
    expect(estadoCiclo(ciclo({})).texto).toBe("Validado");
  });
  it("cuenta y suma el agua en m³", () => {
    expect(resumenDia([ciclo({}), ciclo({ val: "desvio" }), ciclo({ val: "fuera" })]))
      .toEqual({ total: 3, validados: 1, desvios: 1, fuera: 1, aguaM3: 3 });
  });
});

describe("fases", () => {
  it("ubica un instante en su fase", () => {
    expect(inicioFase([soda, enj], 1)).toBe(450);
    expect(faseEn([soda, enj], 449)).toBe(0);
    expect(faseEn([soda, enj], 450)).toBe(1);
    expect(faseEn([soda, enj], 9999)).toBe(1);
  });
  it("mmss rellena con ceros", () => expect(mmss(65)).toBe("01:05"));
});

describe("consumos", () => {
  it("el período incluye el inicio y excluye el fin", () => {
    const t = HOY.getTime();
    expect(periodo([ciclo({})], t, t + 1).ciclos).toBe(1);
    expect(periodo([ciclo({})], t + 1, t + 2).ciclos).toBe(0);
  });
  it("describe la variación con su dirección", () => {
    expect(variacion(93, 100)).toEqual({ texto: "▼ 7 % vs mes anterior", baja: true });
    expect(variacion(110, 100).baja).toBe(false);
    expect(variacion(1, 0).texto).toBe("");
  });
  it("incluye días sin ciclos y termina hoy", () => {
    const d = aguaPorDia([ciclo({ agua: 2000 })], HOY, 3);
    expect(d.map((x) => x.m3)).toEqual([0, 0, 2]);
  });
  it("ordena los circuitos por agua", () => {
    const r = aguaPorCircuito([ciclo({ circuito: "A", agua: 1000 }), ciclo({ circuito: "B", agua: 3000 })], 0);
    expect(r[0]).toEqual({ n: "B", m3: 3 });
  });
  it("calcula el % validado por semana", () => {
    const s = semanas([ciclo({}), ciclo({ val: "desvio" })], HOY, 2);
    expect(s[1]).toMatchObject({ pct: 50, desvios: 1, ciclos: 2 });
    expect(s[0].ciclos).toBe(0);
  });
  it("conoce los días libres de cada circuito", () => {
    expect(programadosEn(new Date(2026, 10, 2))).toBe(8);   // lunes
    expect(programadosEn(new Date(2026, 10, 1))).toBe(4);   // domingo
  });
});
