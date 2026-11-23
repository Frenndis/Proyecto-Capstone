import { describe, expect, it } from "vitest";
import { CIRCUITOS, crearSimulador, resumir } from "./motor";
import { ErrorPlan, idDesdeNombre, normalizarPlan, planDesdeDoc } from "./planes";
import { iCircuito } from "./ml";

const base = {
  nombre: "Tina 3 · quesería", area: "Quesería", receta: "Quesería corta",
  fases: [
    { n: "Preenjuague", min: 3, t: 35 },
    { n: "Soda", min: 10, t: 75, c: 1.2, tMin: 70, q: 20 },
    { n: "Enjuague final", min: 4, t: 30 },
  ],
};

describe("normalizarPlan", () => {
  it("arma un plan nuevo con id derivado del nombre y valores por defecto", () => {
    const p = normalizarPlan(base);
    expect(p.id).toBe("tina-3-queseria");
    expect(p.activo).toBe(true);
    expect(p.fases.map((f) => f.s)).toEqual([180, 600, 240]);
    expect(p.fases[1]).toMatchObject({ etapa: "alcalino", c: 1.2, min: 70, q: 20, chem: 1.8, enjuague: false });
    expect(p.fases[0]).toMatchObject({ c: 0, min: null, q: 24 });
    expect(p.fases[2].enjuague).toBe(true);
  });

  it("el plan creado corre en el simulador y cierra un ciclo", () => {
    const p = normalizarPlan(base);
    const r = resumir(p, { semilla: 7 });
    expect(r.duracionS).toBe(1020);
    expect(r.aguaL).toBeGreaterThan(0);
    expect(crearSimulador(p, { semilla: 7 }).en(300).temp).toBeGreaterThan(40);
  });

  it("acepta números escritos con coma", () => {
    const p = normalizarPlan({ ...base, fases: [{ n: "Soda", min: "7,5" as never, t: 70, c: "1,3" as never }] });
    expect(p.fases[0]).toMatchObject({ s: 450, c: 1.3 });
  });

  it("al modificar conserva el id y lo que el formulario no edita", () => {
    const previo = { ...CIRCUITOS[4], activo: true };
    const p = normalizarPlan({ ...base, id: "otro", nombre: "Pasteurizador 2", fases: [{ n: "Soda", min: 20, t: 80, c: 1.5, tMin: 75 }] }, previo);
    expect(p.id).toBe("past");
    expect(p.sobredosis).toBe(1.09);
    expect(p.fases[0].fresh).toBe(previo.fases.find((f) => f.n === "Soda")!.fresh);
  });

  it.each([
    ["sin nombre", { ...base, nombre: " " }],
    ["sin fases", { ...base, fases: [] }],
    ["fase repetida", { ...base, fases: [base.fases[0], base.fases[0]] }],
    ["tipo desconocido", { ...base, fases: [{ n: "Vapor", min: 2, t: 90 }] }],
    ["química sin concentración", { ...base, fases: [{ n: "Soda", min: 5, t: 70 }] }],
    ["mínimo sobre el objetivo", { ...base, fases: [{ n: "Soda", min: 5, t: 70, c: 1, tMin: 80 }] }],
    ["duración fuera de rango", { ...base, fases: [{ n: "Enjuague", min: 0, t: 30 }] }],
    ["todos los días libres", { ...base, libres: [0, 1, 2, 3, 4, 5, 6] }],
  ])("rechaza %s", (_, entrada) => {
    expect(() => normalizarPlan(entrada as never)).toThrow(ErrorPlan);
  });
});

describe("apoyo", () => {
  it("idDesdeNombre quita tildes y símbolos", () => {
    expect(idDesdeNombre("  Línea Ñandú #2 ")).toBe("linea-nandu-2");
  });
  it("planDesdeDoc descarta documentos incompletos", () => {
    expect(planDesdeDoc("x", { nombre: "X", fases: [] })).toBeNull();
    expect(planDesdeDoc("x", { nombre: "X", fases: [{ n: "Soda" }] })).toBeNull();
    const ok = planDesdeDoc("and1", { ...CIRCUITOS[0], activo: false });
    expect(ok).toMatchObject({ id: "and1", activo: false });
  });
  it("iCircuito: los de fábrica conservan su índice y los nuevos reciben uno estable", () => {
    expect(iCircuito("and2")).toBe(1);
    expect(iCircuito("tina-3-queseria")).toBe(iCircuito("tina-3-queseria"));
    expect(iCircuito("tina-3-queseria")).toBeGreaterThanOrEqual(CIRCUITOS.length);
  });
});
