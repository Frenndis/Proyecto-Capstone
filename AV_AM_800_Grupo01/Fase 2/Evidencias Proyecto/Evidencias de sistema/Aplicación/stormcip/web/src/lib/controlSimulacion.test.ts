import { describe, expect, it } from "vitest";
import {
  RESPUESTA_MAX_MS, SIN_LATIDO, VIVO_MS, armarOrden, estadoBoton, latidoVivo, resultadoDeOrden, seguirLatido,
} from "./controlSimulacion";
import {
  ETIQUETA_SELECCION, LINEA_DEMO, LINEA_REAL, leerSeleccion, lineaDe, ultimoFinalizado,
} from "./lineas";

const T = 1_000_000;

describe("seguirLatido / latidoVivo", () => {
  it("sin documento o sin contador: apagado", () => {
    expect(seguirLatido(SIN_LATIDO, undefined, T)).toEqual(SIN_LATIDO);
    expect(latidoVivo(SIN_LATIDO, T)).toBe(false);
  });

  it("el primer valor no prueba que esté vivo: hay que ver un cambio", () => {
    const s = seguirLatido(SIN_LATIDO, 10, T);
    expect(s).toEqual({ ultimoLatido: 10, cambioMs: null });
    expect(latidoVivo(s, T)).toBe(false);
    expect(latidoVivo(s, T + 60_000)).toBe(false);
  });

  it("un cambio del contador lo da por vivo durante VIVO_MS", () => {
    let s = seguirLatido(SIN_LATIDO, 10, T);
    s = seguirLatido(s, 11, T + 5000);
    expect(latidoVivo(s, T + 5000)).toBe(true);
    expect(latidoVivo(s, T + 5000 + VIVO_MS - 1)).toBe(true);
    expect(latidoVivo(s, T + 5000 + VIVO_MS)).toBe(false);
  });

  it("el mismo valor repetido (snapshot sin cambio) no renueva", () => {
    let s = seguirLatido(seguirLatido(SIN_LATIDO, 10, T), 11, T + 5000);
    s = seguirLatido(s, 11, T + 9000);
    expect(s.cambioMs).toBe(T + 5000);
  });

  it("si el simulador se reinicia y el contador baja, también cuenta como cambio", () => {
    let s = seguirLatido(seguirLatido(SIN_LATIDO, 50, T), 51, T + 5000);
    s = seguirLatido(s, 1, T + 30_000);
    expect(latidoVivo(s, T + 30_000)).toBe(true);
  });

  it("si el documento desaparece, vuelve a apagado", () => {
    const s = seguirLatido(seguirLatido(SIN_LATIDO, 10, T), 11, T + 5000);
    expect(seguirLatido(s, undefined, T + 6000)).toEqual(SIN_LATIDO);
  });
});

describe("armarOrden", () => {
  it("iniciar lleva escenario", () => {
    expect(armarOrden("iniciar", "falla", "id-12345678", "u1")).toEqual({
      comando: "iniciar", escenario: "falla", solicitudId: "id-12345678", solicitadoPor: "u1",
    });
  });
  it("detener no lleva escenario (las reglas no lo piden)", () => {
    const o = armarOrden("detener", "normal", "id-12345678", "u1");
    expect(o).toEqual({ comando: "detener", solicitudId: "id-12345678", solicitadoPor: "u1" });
    expect("escenario" in o).toBe(false);
  });
});

describe("resultadoDeOrden", () => {
  const p = { solicitudId: "abc", enviadaMs: T };
  it("sin orden en vuelo: nada", () => expect(resultadoDeOrden(null, undefined, T)).toBeNull());
  it("esperando mientras el simulador no la haya procesado", () => {
    expect(resultadoDeOrden(p, { ultimaSolicitudId: "otra" }, T + 3000)).toEqual({ tipo: "esperando" });
    expect(resultadoDeOrden(p, undefined, T + 3000)).toEqual({ tipo: "esperando" });
  });
  it("aceptada cuando el simulador publica su solicitudId sin rechazo", () => {
    expect(resultadoDeOrden(p, { ultimaSolicitudId: "abc", ultimoRechazo: null }, T + 1000)).toEqual({ tipo: "aceptada" });
  });
  it("rechazada con el motivo", () => {
    expect(resultadoDeOrden(p, { ultimaSolicitudId: "abc", ultimoRechazo: "ya hay una simulación en curso" }, T + 1000))
      .toEqual({ tipo: "rechazada", motivo: "ya hay una simulación en curso" });
  });
  it("sin respuesta pasado RESPUESTA_MAX_MS", () => {
    expect(resultadoDeOrden(p, undefined, T + RESPUESTA_MAX_MS + 1)).toEqual({ tipo: "sin_respuesta" });
  });
});

describe("estadoBoton", () => {
  const base = { vivo: true, estado: { estado: "libre" as const }, cicloEnCursoId: null, esperandoRespuesta: false };

  it("simulador vivo, libre y sin ciclo: se puede iniciar, no detener", () => {
    expect(estadoBoton(base)).toEqual({ puedeIniciar: true, puedeDetener: false, motivoIniciar: null });
  });
  it("simulador apagado: nada habilitado", () => {
    const e = estadoBoton({ ...base, vivo: false });
    expect(e.puedeIniciar).toBe(false);
    expect(e.puedeDetener).toBe(false);
    expect(e.motivoIniciar).toMatch(/apagado/);
  });
  it("sin documento de estado: tampoco hay nada que habilitar", () => {
    expect(estadoBoton({ ...base, vivo: false, estado: undefined }).puedeIniciar).toBe(false);
  });
  it("simulación en marcha: se puede detener, no iniciar", () => {
    const e = estadoBoton({ ...base, estado: { estado: "ejecutando" }, cicloEnCursoId: "SIM-1" });
    expect(e).toMatchObject({ puedeIniciar: false, puedeDetener: true });
    expect(e.motivoIniciar).toMatch(/en curso/);
  });
  it("hay un ciclo en curso que no es de la simulación: no inicia y avisa cuál", () => {
    const e = estadoBoton({ ...base, cicloEnCursoId: "CIP-2026-0001" });
    expect(e.puedeIniciar).toBe(false);
    expect(e.puedeDetener).toBe(false);
    expect(e.motivoIniciar).toContain("CIP-2026-0001");
  });
  it("con una orden en vuelo (doble clic): nada habilitado", () => {
    expect(estadoBoton({ ...base, esperandoRespuesta: true })).toMatchObject({ puedeIniciar: false, puedeDetener: false });
    expect(estadoBoton({ ...base, estado: { estado: "ejecutando" }, esperandoRespuesta: true }).puedeDetener).toBe(false);
  });
  it("simulador apagado con estado 'ejecutando' viejo: no deja detener", () => {
    expect(estadoBoton({ ...base, vivo: false, estado: { estado: "ejecutando" } }).puedeDetener).toBe(false);
  });
});

describe("selección de línea", () => {
  it("lineaDe", () => {
    expect(lineaDe("todas")).toBeUndefined();
    expect(lineaDe("real")).toBe(LINEA_REAL);
    expect(lineaDe("demo")).toBe(LINEA_DEMO);
  });
  it("leerSeleccion acepta lo válido y cae a 'todas' con cualquier otra cosa", () => {
    expect(leerSeleccion("demo")).toBe("demo");
    expect(leerSeleccion("real")).toBe("real");
    expect(leerSeleccion("basura")).toBe("todas");
    expect(leerSeleccion(null)).toBe("todas");
    expect(leerSeleccion(undefined)).toBe("todas");
  });
  it("hay una etiqueta por selección", () => {
    expect(Object.keys(ETIQUETA_SELECCION).sort()).toEqual(["demo", "real", "todas"]);
  });
  it("ultimoFinalizado toma el primero finalizado de la lista ya ordenada", () => {
    const ciclos = [{ id: "a", estado: "abortado" }, { id: "b", estado: "finalizado" }, { id: "c", estado: "finalizado" }];
    expect(ultimoFinalizado(ciclos)?.id).toBe("b");
    expect(ultimoFinalizado([{ estado: "abortado" }])).toBeNull();
    expect(ultimoFinalizado([])).toBeNull();
  });
});
