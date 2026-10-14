import { describe, expect, it } from "vitest";
import { ANTIGUEDAD_MAX_MS, EstadoSimulador, Orden, decidir, docEstado } from "./controlSimulacion";

const AHORA = Date.parse("2026-10-14T12:00:00Z");
const libre: EstadoSimulador = { estado: "libre", ultimaSolicitudId: null };
const ejecutando: EstadoSimulador = { estado: "ejecutando", ultimaSolicitudId: "previa-0001" };
const ctx = (solicitadoEnMs: number | null = AHORA - 1000) => ({ ahoraMs: AHORA, solicitadoEnMs });
const orden = (p: Orden = {}): Orden => ({
  comando: "iniciar", escenario: "normal", solicitudId: "abcdef12-0001", solicitadoPor: "u1", ...p,
});

describe("decidir: órdenes válidas", () => {
  it("iniciar con el simulador libre", () => {
    expect(decidir(orden(), libre, ctx())).toEqual({ accion: "iniciar", escenario: "normal" });
    expect(decidir(orden({ escenario: "falla" }), libre, ctx())).toEqual({ accion: "iniciar", escenario: "falla" });
  });
  it("detener con una simulación en marcha (no pide escenario)", () => {
    expect(decidir(orden({ comando: "detener", escenario: undefined }), ejecutando, ctx())).toEqual({ accion: "detener" });
  });
});

describe("decidir: rechazos", () => {
  it("iniciar mientras ya hay una simulación (doble clic de otra sesión)", () => {
    expect(decidir(orden(), ejecutando, ctx())).toEqual({ accion: "rechazar", motivo: "ya hay una simulación en curso" });
  });
  it("detener sin simulación", () => {
    expect(decidir(orden({ comando: "detener" }), libre, ctx()))
      .toEqual({ accion: "rechazar", motivo: "no hay una simulación en curso" });
  });
  it("comando o escenario desconocidos", () => {
    expect(decidir(orden({ comando: "borrar" }), libre, ctx())).toMatchObject({ accion: "rechazar" });
    expect(decidir(orden({ escenario: "otro" }), libre, ctx())).toMatchObject({ accion: "rechazar" });
    expect(decidir(orden({ escenario: undefined }), libre, ctx())).toMatchObject({ accion: "rechazar" });
  });
  it("sin solicitudId o con uno que no es texto", () => {
    expect(decidir(orden({ solicitudId: undefined }), libre, ctx())).toMatchObject({ accion: "rechazar" });
    expect(decidir(orden({ solicitudId: "" }), libre, ctx())).toMatchObject({ accion: "rechazar" });
    expect(decidir(orden({ solicitudId: 12345678 }), libre, ctx())).toMatchObject({ accion: "rechazar" });
  });
});

describe("decidir: órdenes viejas y repetidas", () => {
  it("una orden vencida no se ejecuta (quedó escrita con el simulador apagado)", () => {
    expect(decidir(orden(), libre, ctx(AHORA - ANTIGUEDAD_MAX_MS - 1)))
      .toEqual({ accion: "rechazar", motivo: "orden vencida (más de 60 s)" });
  });
  it("justo en el límite todavía vale", () => {
    expect(decidir(orden(), libre, ctx(AHORA - ANTIGUEDAD_MAX_MS))).toMatchObject({ accion: "iniciar" });
  });
  it("la misma solicitudId no se procesa dos veces (snapshot repetido, reinicio del simulador)", () => {
    const yaProcesada = { estado: "libre" as const, ultimaSolicitudId: "abcdef12-0001" };
    expect(decidir(orden(), yaProcesada, ctx())).toEqual({ accion: "ignorar", motivo: "orden ya procesada" });
  });
  it("la ya procesada se ignora aunque esté vencida (no se vuelve a rechazar)", () => {
    const yaProcesada = { estado: "libre" as const, ultimaSolicitudId: "abcdef12-0001" };
    expect(decidir(orden(), yaProcesada, ctx(AHORA - 10 * ANTIGUEDAD_MAX_MS))).toMatchObject({ accion: "ignorar" });
  });
  it("sin orden: no hace nada", () => {
    expect(decidir(null, libre, ctx())).toMatchObject({ accion: "ignorar" });
    expect(decidir(undefined, libre, ctx())).toMatchObject({ accion: "ignorar" });
  });
  it("hora aún sin confirmar (serverTimestamp pendiente): espera el siguiente snapshot", () => {
    expect(decidir(orden(), libre, ctx(null))).toEqual({ accion: "ignorar", motivo: "orden aún sin hora confirmada" });
  });
});

describe("docEstado", () => {
  const base = { lineaId: "cip-sim", latido: 7, ultimaSolicitudId: "abc", ultimoRechazo: null };
  it("libre", () => {
    expect(docEstado(base, null)).toEqual({
      v: 1, lineaId: "cip-sim", latido: 7, estado: "libre", cicloId: null, escenario: null,
      ultimaSolicitudId: "abc", ultimoRechazo: null,
    });
  });
  it("ejecutando", () => {
    expect(docEstado(base, { cicloId: "SIM-1", escenario: "falla" })).toMatchObject({
      estado: "ejecutando", cicloId: "SIM-1", escenario: "falla",
    });
  });
});
