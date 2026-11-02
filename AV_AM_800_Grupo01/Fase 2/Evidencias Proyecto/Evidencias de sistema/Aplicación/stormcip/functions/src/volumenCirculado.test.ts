import { describe, expect, it } from "vitest";
import { DocumentReference } from "firebase-admin/firestore";
import {
  CONFIG_VOLUMEN, Intervalo, MuestraProceso, TxVolumen, acumular, idMarcador, intervaloVolumen,
  litrosTrapecio, muestraDe, transaccionVolumen,
} from "./volumenCirculado";
import { RECETA_DEFECTO, duracionReceta, estadoEn } from "./simulacion/modeloCip";

const T0 = Date.UTC(2026, 9, 26, 15, 0, 0);
const muestra = (s: number, caudal: number, etapa = "enjuague", extra: Partial<MuestraProceso> = {}): MuestraProceso =>
  ({ cicloId: "C1", etapa, estadoCiclo: "en_curso", caudalM3h: caudal, tsMs: T0 + s * 1000, simulado: true, ...extra });

describe("litrosTrapecio", () => {
  it("caudal constante: 18 m³/h = 5 L/s → 10 L en 2 s", () => {
    expect(litrosTrapecio(18, 18, 2)).toBeCloseTo(10, 10);
  });
  it("rampa: promedia los dos extremos", () => {
    expect(litrosTrapecio(0, 18, 2)).toBeCloseTo(5, 10);
  });
});

describe("muestraDe", () => {
  const doc = (o: Record<string, any> = {}) => ({
    cicloId: "C1", etapa: "enjuague", estadoCiclo: "en_curso", simulado: true,
    instrumentos: { caudal: 18 }, actualizadoEn: { toMillis: () => T0 }, ...o,
  });
  it("lee caudal, hora, etapa y ciclo", () => {
    expect(muestraDe(doc())).toEqual({
      cicloId: "C1", etapa: "enjuague", estadoCiclo: "en_curso", caudalM3h: 18, tsMs: T0, simulado: true,
    });
  });
  it("acepta la hora como Timestamp con toDate", () => {
    expect(muestraDe(doc({ actualizadoEn: { toDate: () => new Date(T0) } }))?.tsMs).toBe(T0);
  });
  it("sin caudal (equipo sin caudalímetro), sin hora o con caudal inválido: null", () => {
    expect(muestraDe(doc({ instrumentos: {} }))).toBeNull();
    expect(muestraDe(doc({ instrumentos: { caudal: -1 } }))).toBeNull();
    expect(muestraDe(doc({ instrumentos: { caudal: NaN } }))).toBeNull();
    expect(muestraDe(doc({ actualizadoEn: null }))).toBeNull();   // serverTimestamp aún sin confirmar
    expect(muestraDe(undefined)).toBeNull();
  });
});

describe("intervaloVolumen", () => {
  it("dos lecturas de la misma etapa: suma el trapecio", () => {
    const i = intervaloVolumen(muestra(0, 18), muestra(2, 18));
    expect(i).toMatchObject({ tipo: "suma", cicloId: "C1", etapa: "enjuague" });
    expect((i as { litros: number }).litros).toBeCloseTo(10, 10);
  });
  it("cambio de etapa (borde): no se cuenta", () => {
    expect(intervaloVolumen(muestra(0, 18, "enjuague"), muestra(2, 0, "acido")))
      .toEqual({ tipo: "omitido", motivo: "cambio de etapa (borde, no se cuenta)" });
  });
  it("ciclos distintos: no se cuenta", () => {
    expect(intervaloVolumen(muestra(0, 18), muestra(2, 18, "enjuague", { cicloId: "C2" })).tipo).toBe("omitido");
  });
  it("ciclo que ya no estaba en curso: no se cuenta", () => {
    expect(intervaloVolumen(muestra(0, 0, "enjuague", { estadoCiclo: "finalizado" }), muestra(2, 0)).tipo).toBe("omitido");
  });
  it("la última lectura puede ser del cierre (bomba apagada): su rampa de bajada sí se cuenta", () => {
    const i = intervaloVolumen(muestra(0, 18), muestra(2, 0, "enjuague", { estadoCiclo: "finalizado" }));
    expect(i.tipo).toBe("suma");
  });
  it("intervalo mayor al tope (PLC caído): hueco, sin sumar", () => {
    const i = intervaloVolumen(muestra(0, 18), muestra(CONFIG_VOLUMEN.huecoMaxS + 1, 18));
    expect(i).toMatchObject({ tipo: "hueco", etapa: "enjuague" });
    expect(intervaloVolumen(muestra(0, 18), muestra(CONFIG_VOLUMEN.huecoMaxS, 18)).tipo).toBe("suma");
  });
  it("intervalo no positivo o etapa inválida: se omite", () => {
    expect(intervaloVolumen(muestra(2, 18), muestra(2, 18)).tipo).toBe("omitido");
    expect(intervaloVolumen(muestra(2, 18), muestra(0, 18)).tipo).toBe("omitido");
    expect(intervaloVolumen(muestra(0, 18, "otra"), muestra(2, 18, "otra")).tipo).toBe("omitido");
  });
  it("falta una muestra: se omite", () => {
    expect(intervaloVolumen(null, muestra(2, 18)).tipo).toBe("omitido");
  });
});

describe("acumular", () => {
  const suma = (etapa: any, litros: number): Intervalo => ({ tipo: "suma", cicloId: "C1", etapa, litros, simulado: true });
  it("suma por etapa sin modificar el original", () => {
    const a = acumular(undefined, suma("alcalino", 10) as any);
    const b = acumular(a, suma("alcalino", 5) as any);
    const c = acumular(b, suma("acido", 7) as any);
    expect(a.litros).toEqual({ alcalino: 10 });
    expect(c.litros).toEqual({ alcalino: 15, acido: 7 });
    expect(c).toMatchObject({ huecos: 0, simulado: true });
  });
  it("un hueco solo cuenta el hueco", () => {
    const r = acumular({ litros: { alcalino: 10 }, huecos: 1, simulado: true },
      { tipo: "hueco", cicloId: "C1", etapa: "alcalino", simulado: true });
    expect(r).toEqual({ litros: { alcalino: 10 }, huecos: 2, simulado: true });
  });
});

describe("idMarcador", () => {
  it("deja el ID del evento apto para una ruta de Firestore", () => {
    expect(idMarcador("a/b c:d")).toBe("a_b_c_d");
    expect(idMarcador("abc-123_x.y")).toBe("abc-123_x.y");
  });
});

// ── Transacción simulada: documentos en memoria ──
type Doc = Record<string, any>;
const ref = (path: string) => ({ id: path.split("/").pop(), path }) as unknown as DocumentReference;

function crearTx(docs: Record<string, Doc>) {
  const snap = (path: string) => {
    const d = docs[path];
    return { exists: d !== undefined, data: () => d, get: (k: string) => d?.[k] };
  };
  const tx = {
    getAll: async (...refs: DocumentReference[]) => refs.map((r) => snap(r.path)),
    set: (r: DocumentReference, data: Doc) => { docs[r.path] = data; return tx; },
    update: (r: DocumentReference, data: Doc) => { docs[r.path] = { ...docs[r.path], ...data }; return tx; },
  };
  return tx as unknown as TxVolumen;
}

type Evento = { id: string; intervalo: Exclude<Intervalo, { tipo: "omitido" }> };
const entregar = (docs: Record<string, Doc>, e: Evento) =>
  transaccionVolumen(crearTx(docs), {
    eventId: e.id, cicloRef: ref("ciclos/C1"), marcadorRef: ref(`ciclos/C1/eventosVolumen/${idMarcador(e.id)}`),
    intervalo: e.intervalo, ahoraMs: T0,
  });
const ciclo = () => ({ "ciclos/C1": { estado: "en_curso" } } as Record<string, Doc>);

/** Barajado determinista (LCG): el mismo desorden en cada corrida. */
function barajar<T>(xs: T[], semilla: number): T[] {
  const a = [...xs];
  let s = semilla;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("transaccionVolumen", () => {
  const ev = (id: string, etapa: any, litros: number): Evento =>
    ({ id, intervalo: { tipo: "suma", cicloId: "C1", etapa, litros, simulado: true } });

  it("suma el intervalo, deja un marcador y devuelve 'sumado'", async () => {
    const docs = ciclo();
    expect(await entregar(docs, ev("e1", "alcalino", 10))).toBe("sumado");
    expect(docs["ciclos/C1"].volumenCirculado.litros).toEqual({ alcalino: 10 });
    expect(docs["ciclos/C1/eventosVolumen/e1"]).toMatchObject({ eventId: "e1", etapa: "alcalino", litros: 10 });
    expect(docs["ciclos/C1/eventosVolumen/e1"].expiraEn.toMillis())
      .toBe(T0 + CONFIG_VOLUMEN.retencionMarcadoresDias * 86_400_000);
  });

  it("el mismo evento entregado dos veces se cuenta una sola", async () => {
    const docs = ciclo();
    expect(await entregar(docs, ev("e1", "alcalino", 10))).toBe("sumado");
    expect(await entregar(docs, ev("e1", "alcalino", 10))).toBe("duplicado");
    expect(docs["ciclos/C1"].volumenCirculado.litros).toEqual({ alcalino: 10 });
  });

  it("un hueco suma el contador y no los litros", async () => {
    const docs = ciclo();
    const r = await entregar(docs, { id: "h1", intervalo: { tipo: "hueco", cicloId: "C1", etapa: "enjuague", simulado: true } });
    expect(r).toBe("hueco");
    expect(docs["ciclos/C1"].volumenCirculado).toMatchObject({ litros: {}, huecos: 1 });
    expect(docs["ciclos/C1/eventosVolumen/h1"].litros).toBeNull();
  });

  it("ciclo inexistente: no escribe nada", async () => {
    const docs: Record<string, Doc> = {};
    expect(await entregar(docs, ev("e1", "alcalino", 10))).toBe("sin_ciclo");
    expect(docs).toEqual({});
  });

  // Firestore no garantiza el orden de entrega. Un control basado en "la última
  // muestra" descartaría como viejo un evento atrasado y perdería su volumen.
  it("eventos DESORDENADOS dan el mismo total que en orden", async () => {
    const eventos = [
      ev("e1", "alcalino", 10), ev("e2", "alcalino", 20), ev("e3", "alcalino", 30),
      ev("e4", "acido", 40), ev("e5", "acido", 50),
    ];
    const enOrden = ciclo();
    for (const e of eventos) await entregar(enOrden, e);

    const desordenado = ciclo();
    for (const e of [eventos[4], eventos[1], eventos[3], eventos[0], eventos[2]]) await entregar(desordenado, e);

    expect(desordenado["ciclos/C1"].volumenCirculado.litros).toEqual({ alcalino: 60, acido: 90 });
    expect(desordenado["ciclos/C1"].volumenCirculado).toEqual(enOrden["ciclos/C1"].volumenCirculado);
  });

  it("un evento atrasado (de hora anterior a los ya contados) igual se cuenta", async () => {
    const docs = ciclo();
    await entregar(docs, ev("tarde", "alcalino", 30));
    await entregar(docs, ev("temprano", "alcalino", 10));   // llega después, pero ocurrió antes
    expect(docs["ciclos/C1"].volumenCirculado.litros.alcalino).toBe(40);
  });

  it("desordenados Y con duplicados: cada evento cuenta exactamente una vez", async () => {
    const eventos = Array.from({ length: 40 }, (_, i) => ev(`e${i}`, i < 25 ? "alcalino" : "acido", i + 1));
    const esperado = { alcalino: (25 * 26) / 2, acido: (40 * 41) / 2 - (25 * 26) / 2 };

    const docs = ciclo();
    const entrega = barajar([...eventos, ...eventos.slice(5, 30), ...eventos.slice(20), ...eventos.slice(0, 3)], 7);
    expect(entrega.length).toBeGreaterThan(eventos.length);
    for (const e of entrega) await entregar(docs, e);

    expect(docs["ciclos/C1"].volumenCirculado.litros).toEqual(esperado);
    expect(Object.keys(docs).filter((k) => k.includes("/eventosVolumen/"))).toHaveLength(eventos.length);
  });
});

// ── Ciclo completo del simulador (modeloCip.ts): lo que haría el trigger con el tick de 2 s ──
describe("ciclo completo del simulador", () => {
  const TICK_S = 2;
  const total = duracionReceta(RECETA_DEFECTO);
  const muestraSim = (t: number, estadoCiclo: string): MuestraProceso => {
    const e = estadoEn(t).estadoProceso;
    return { cicloId: "C1", etapa: e.etapa, estadoCiclo, caudalM3h: e.instrumentos.caudal, tsMs: T0 + t * 1000, simulado: true };
  };
  const muestras = [
    ...Array.from({ length: total / TICK_S }, (_, i) => muestraSim(i * TICK_S, "en_curso")),
    muestraSim(total, "finalizado"),
  ];
  const eventos: Evento[] = muestras.slice(1).flatMap((m, i) => {
    const iv = intervaloVolumen(muestras[i], m);
    return iv.tipo === "omitido" ? [] : [{ id: `ev${i}`, intervalo: iv }];
  });

  const totales = async (entrega: Evento[]) => {
    const docs = ciclo();
    for (const e of entrega) await entregar(docs, e);
    return docs["ciclos/C1"].volumenCirculado.litros as Record<string, number>;
  };

  // 18 m³/h = 5 L/s; el caudal sube en 3 s y baja en 2 s: cada etapa equivale a (duración − 2,5 s) a caudal pleno
  const exacto = (duracionS: number) => 5 * (duracionS - 2.5);

  // Pérdida documentada en volumenCirculado.ts: la etapa final no pierde el borde
  // de salida porque el cierre del ciclo cuenta su último intervalo.
  it("las etapas intermedias quedan 1,5–3,5 % bajo el valor exacto (pérdida en el borde)", async () => {
    const litros = await totales(eventos);
    for (const p of RECETA_DEFECTO.slice(0, -1)) {
      const razon = litros[p.etapa] / exacto(p.duracionS);
      expect(razon, `${p.etapa}: ${litros[p.etapa]} L`).toBeGreaterThan(0.965);
      expect(razon, `${p.etapa}: ${litros[p.etapa]} L`).toBeLessThan(0.985);
    }
  });

  it("la última etapa (desinfección) pierde casi nada, y se cuenta aunque no estaba en la lista original", async () => {
    const litros = await totales(eventos);
    const razon = litros.desinfeccion / exacto(30);
    expect(razon).toBeGreaterThan(0.99);
    expect(razon).toBeLessThanOrEqual(1.01);
  });

  it("el total del ciclo queda ~2 % bajo el exacto, incluida la desinfección", async () => {
    const litros = await totales(eventos);
    const suma = Object.values(litros).reduce((a, b) => a + b, 0);
    const exactoTotal = RECETA_DEFECTO.reduce((a, p) => a + exacto(p.duracionS), 0);
    expect(suma / exactoTotal).toBeGreaterThan(0.97);
    expect(suma / exactoTotal).toBeLessThan(0.99);
  });

  it("entregando los eventos desordenados y repetidos da el mismo resultado", async () => {
    const referencia = await totales(eventos);
    const revuelto = barajar([...eventos, ...eventos.slice(10, 60), ...eventos.slice(100)], 2026);
    const litros = await totales(revuelto);
    for (const p of RECETA_DEFECTO) expect(litros[p.etapa]).toBeCloseTo(referencia[p.etapa], 6);
  });
});
