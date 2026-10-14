import { describe, expect, it } from "vitest";
// El orden de etapas de la web es una copia: este test falla si se desfasa.
import { ETAPAS, ETAPAS_MONITOREADAS as MONITOREADAS_BACKEND } from "../../../functions/src/types";
import {
  ETAPAS_ORDEN, estadoEtapas, formatearDuracion, procesoDelCiclo, segundosDelCiclo, segundosEnEtapa,
  segundosRestantesCiclo, segundosRestantesEtapa,
} from "./etapas";
import { ETAPAS_MONITOREADAS, EstadoProceso } from "./tipos";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const marca = (offsetS: number) => ({ toDate: () => new Date(T0 + offsetS * 1000) });

describe("ETAPAS_ORDEN", () => {
  it("es idéntico a ETAPAS del backend", () => {
    expect([...ETAPAS_ORDEN]).toEqual([...ETAPAS]);
  });
});

describe("ETAPAS_MONITOREADAS", () => {
  it("es idéntico al del backend", () => {
    expect([...ETAPAS_MONITOREADAS]).toEqual([...MONITOREADAS_BACKEND]);
  });
});

describe("estadoEtapas", () => {
  it("las etapas químicas no son monitoreadas", () => {
    const m = Object.fromEntries(estadoEtapas("enjuague", "en_curso").map((e) => [e.etapa, e.monitoreada]));
    expect(m).toEqual({
      preenjuague: true, alcalino: false, enjuague: true, acido: false, enjuague_final: true, desinfeccion: false,
    });
  });

  const estados = (etapa?: string, ciclo?: string) => estadoEtapas(etapa, ciclo).map((e) => e.estado);

  it("marca hechas las anteriores, la actual y pendientes las siguientes", () => {
    expect(estados("enjuague", "en_curso")).toEqual(
      ["hecha", "hecha", "actual", "pendiente", "pendiente", "pendiente"]);
  });
  it("primera y última etapa", () => {
    expect(estados("preenjuague", "en_curso")[0]).toBe("actual");
    expect(estados("desinfeccion", "en_curso")).toEqual(
      ["hecha", "hecha", "hecha", "hecha", "hecha", "actual"]);
  });
  it("ciclo finalizado: todas hechas", () => {
    expect(new Set(estados("desinfeccion", "finalizado"))).toEqual(new Set(["hecha"]));
  });
  it("ciclo abortado: conserva la etapa en que quedó", () => {
    expect(estados("acido", "abortado")[3]).toBe("actual");
  });
  it("etapa desconocida o ausente: todo pendiente, sin adivinar", () => {
    expect(new Set(estados("otra", "en_curso"))).toEqual(new Set(["pendiente"]));
    expect(new Set(estados(undefined, "en_curso"))).toEqual(new Set(["pendiente"]));
  });
});

describe("formatearDuracion", () => {
  it("mm:ss", () => {
    expect(formatearDuracion(0)).toBe("00:00");
    expect(formatearDuracion(65.9)).toBe("01:05");
    expect(formatearDuracion(599)).toBe("09:59");
  });
  it("con horas", () => expect(formatearDuracion(3725)).toBe("1:02:05"));
  it("sin dato", () => {
    expect(formatearDuracion(null)).toBe("—");
    expect(formatearDuracion(undefined)).toBe("—");
    expect(formatearDuracion(-1)).toBe("—");
    expect(formatearDuracion(NaN)).toBe("—");
  });
});

describe("segundosDelCiclo", () => {
  it("en curso: hasta ahora", () => {
    expect(segundosDelCiclo(marca(0), undefined, T0 + 90_000)).toBe(90);
  });
  it("cerrado: hasta fin, no hasta ahora", () => {
    expect(segundosDelCiclo(marca(0), marca(300), T0 + 9_999_000)).toBe(300);
  });
  it("inicio aún sin confirmar (serverTimestamp): null", () => {
    expect(segundosDelCiclo(null, undefined, T0)).toBeNull();
    expect(segundosDelCiclo(undefined, undefined, T0)).toBeNull();
  });
  it("nunca negativo (reloj atrasado)", () => {
    expect(segundosDelCiclo(marca(10), undefined, T0)).toBe(0);
  });
});

const proceso = (p: Partial<EstadoProceso> = {}) => ({
  cicloId: "C1", etapa: "enjuague", estadoCiclo: "en_curso", etapaInicio: marca(100), ...p,
}) as unknown as EstadoProceso;
const ciclo = { id: "C1", etapaActual: "enjuague", estado: "en_curso" };

describe("procesoDelCiclo", () => {
  it("solo si es del mismo ciclo", () => {
    expect(procesoDelCiclo(proceso(), "C1")).not.toBeNull();
    expect(procesoDelCiclo(proceso(), "C2")).toBeNull();
    expect(procesoDelCiclo(null, "C1")).toBeNull();
    expect(procesoDelCiclo(proceso(), undefined)).toBeNull();
  });
});

describe("segundosEnEtapa", () => {
  const ahora = T0 + 130_000;
  it("desde etapaInicio de estadoProceso", () => {
    expect(segundosEnEtapa(ciclo, proceso(), false, ahora)).toBe(30);
  });
  it("null si estadoProceso es de otro ciclo", () => {
    expect(segundosEnEtapa(ciclo, proceso({ cicloId: "OTRO" }), false, ahora)).toBeNull();
  });
  it("null si estadoProceso está detenido", () => {
    expect(segundosEnEtapa(ciclo, proceso(), true, ahora)).toBeNull();
  });
  it("null si las fuentes no coinciden en la etapa", () => {
    expect(segundosEnEtapa(ciclo, proceso({ etapa: "acido" }), false, ahora)).toBeNull();
  });
  it("null si el ciclo ya no está en curso", () => {
    expect(segundosEnEtapa({ ...ciclo, estado: "finalizado" }, proceso(), false, ahora)).toBeNull();
    expect(segundosEnEtapa(ciclo, proceso({ estadoCiclo: "abortado" }), false, ahora)).toBeNull();
  });
  it("null sin etapaInicio confirmado o sin estadoProceso", () => {
    expect(segundosEnEtapa(ciclo, proceso({ etapaInicio: null }), false, ahora)).toBeNull();
    expect(segundosEnEtapa(ciclo, null, false, ahora)).toBeNull();
  });
});

const procesoConDuraciones = (p: Partial<EstadoProceso> = {}) => proceso({
  etapaDuracionS: 60, cicloDuracionS: 300, transcurridoS: 100,
  actualizadoEn: marca(130), ...p,
} as Partial<EstadoProceso>);

describe("segundosRestantesEtapa", () => {
  const ahora = T0 + 130_000; // 30 s en la etapa (etapaInicio = +100 s)
  it("duración de la etapa menos lo transcurrido en ella", () => {
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones(), false, ahora)).toBe(30);
  });
  it("nunca negativo", () => {
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones({ etapaDuracionS: 20 }), false, ahora)).toBe(0);
  });
  it("null si falta la duración o no es válida", () => {
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones({ etapaDuracionS: 0 }), false, ahora)).toBeNull();
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones({ etapaDuracionS: undefined }), false, ahora)).toBeNull();
  });
  it("null si el estado de planta no es vigente", () => {
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones(), true, ahora)).toBeNull();
    expect(segundosRestantesEtapa(ciclo, procesoConDuraciones({ cicloId: "OTRO" }), false, ahora)).toBeNull();
    expect(segundosRestantesEtapa(ciclo, null, false, ahora)).toBeNull();
  });
});

describe("segundosRestantesCiclo", () => {
  it("duración del ciclo menos transcurrido, sumando lo que pasó desde la última escritura", () => {
    // escrito en +130 s con 100 s transcurridos; ahora +135 s → 105 s transcurridos
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones(), false, T0 + 135_000)).toBe(195);
  });
  it("nunca negativo", () => {
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones({ transcurridoS: 400 }), false, T0 + 135_000)).toBe(0);
  });
  it("un reloj atrasado no suma tiempo negativo", () => {
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones(), false, T0 + 120_000)).toBe(200);
  });
  it("null si no es vigente, no es del ciclo, el ciclo no está en curso o faltan datos", () => {
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones(), true, T0)).toBeNull();
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones({ cicloId: "OTRO" }), false, T0)).toBeNull();
    expect(segundosRestantesCiclo({ ...ciclo, estado: "finalizado" }, procesoConDuraciones(), false, T0)).toBeNull();
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones({ cicloDuracionS: 0 }), false, T0)).toBeNull();
    expect(segundosRestantesCiclo(ciclo, procesoConDuraciones({ actualizadoEn: null }), false, T0)).toBeNull();
  });
});
