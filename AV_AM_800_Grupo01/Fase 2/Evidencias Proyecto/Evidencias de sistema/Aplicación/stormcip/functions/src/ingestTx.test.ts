import { describe, expect, it } from "vitest";
import { DocumentReference, FieldPath, Timestamp } from "firebase-admin/firestore";
import { DatosIngesta, TxIngesta, transaccionIngesta } from "./ingest";
import { Sonda } from "./types";

// ── Transacción simulada: documentos en memoria y registro de escrituras ──
type Doc = Record<string, any>;
type Escritura = { op: "set" | "update"; path: string; data?: Doc; args?: unknown[] };

const ref = (path: string) => ({ id: path.split("/").pop(), path }) as unknown as DocumentReference;

function crearTx(docs: Record<string, Doc>) {
  const escrituras: Escritura[] = [];
  const snap = (path: string) => {
    const d = docs[path];
    return { exists: d !== undefined, data: () => d, get: (k: string) => d?.[k] };
  };
  const tx = {
    getAll: async (...refs: DocumentReference[]) => refs.map((r) => snap(r.path)),
    set: (r: DocumentReference, data: Doc) => { escrituras.push({ op: "set", path: r.path, data }); return tx; },
    update: (r: DocumentReference, ...args: unknown[]) => {
      escrituras.push({ op: "update", path: r.path, args });
      return tx;
    },
  };
  return { tx: tx as unknown as TxIngesta, escrituras };
}

/** ¿El update del ciclo toca este campo (como string o como FieldPath)? */
function tocaCampo(e: Escritura | undefined, ...segmentos: string[]) {
  const campo = new FieldPath(...segmentos);
  return (e?.args ?? []).some((a) =>
    (typeof a === "string" && segmentos.length === 1 && a === segmentos[0]) ||
    (a instanceof FieldPath && a.isEqual(campo)));
}

const t = (min: number) => Timestamp.fromMillis(Date.UTC(2026, 9, 9, 14, min, 0));
const CICLO = "ciclos/CIP-1";
const SONDAS: Record<string, Sonda> = {
  s1: { sondaId: "s1", modelo: "DR-PH01",   activa: true },
  s2: { sondaId: "s2", modelo: "DR-ECK1.0", activa: true },
};

// EC25 = 500: bajo el umbral del enjuague (1500), sobre el del enjuague final (300)
function datos(ts = t(10)): DatosIngesta {
  return {
    deviceId: "wqs-lb-01", cicloId: "CIP-1", ts,
    lecturaRef: ref(`${CICLO}/lecturas/L1`), cicloRef: ref(CICLO),
    dispositivoRef: ref("dispositivos/wqs-lb-01"),
    refAlerta: (id) => ref(`alertas/${id}`),
    limpios: { conductividad: 450, tempEc: 20 },
    numericos: { conductividad: 450, tempEc: 20 },
    derivados: { conductividad25C: 500 }, metodo: {},
    confianza: { conductividad: "medido", tempEc: "medido", conductividad25C: "medido" },
    descartadas: {}, vistas: ["conductividad", "conductividad25C", "tempEc"],
    umbrales: {
      enjuague: { conductividad25C: { max: 1500 } },
      enjuague_final: { conductividad25C: { max: 300 } },
    },
    sondas: SONDAS,
  };
}

describe("transaccionIngesta — la etapa sale del ciclo leído dentro de la transacción", () => {
  // El adaptador resolvió el ciclo cuando estaba en "enjuague"; antes de que
  // la transacción lo lea, el director pasa a "enjuague_final"
  it("si la etapa cambia antes de confirmar, la lectura y sus alertas usan la nueva", async () => {
    const docs: Record<string, Doc> = { [CICLO]: { etapaActual: "enjuague", lineaId: "cip-01" } };
    const etapaVistaFuera = docs[CICLO].etapaActual;
    docs[CICLO] = { ...docs[CICLO], etapaActual: "enjuague_final" };

    const { tx, escrituras } = crearTx(docs);
    const r = await transaccionIngesta(tx, datos());

    expect(etapaVistaFuera).toBe("enjuague");
    expect(r).toMatchObject({ ok: true, etapa: "enjuague_final", duplicado: false, alertas: 1 });
    const lectura = escrituras.find((e) => e.path === `${CICLO}/lecturas/L1`);
    expect(lectura?.data?.etapa).toBe("enjuague_final");
    // Umbral del enjuague final (300), no el del enjuague (1500)
    const alerta = escrituras.find((e) => e.path.startsWith("alertas/"));
    expect(alerta?.path).toBe("alertas/CIP-1_enjuague_final_conductividad25C");
    expect(alerta?.data).toMatchObject({ etapa: "enjuague_final", max: 300 });
  });

  it("la ingesta no escribe etapaActual en el ciclo", async () => {
    const { tx, escrituras } = crearTx({ [CICLO]: { etapaActual: "enjuague" } });
    await transaccionIngesta(tx, datos());
    const cicloUpdate = escrituras.find((e) => e.path === CICLO);
    expect(cicloUpdate?.op).toBe("update");
    expect(tocaCampo(cicloUpdate, "etapaActual")).toBe(false);
    expect(tocaCampo(cicloUpdate, "ultimaLectura", "wqs-lb-01")).toBe(true);
    // Ninguna escritura (ciclo, lectura, alertas, dispositivo) lleva etapaActual
    for (const e of escrituras) expect(e.data ?? {}).not.toHaveProperty("etapaActual");
  });

  it("una lectura atrasada se guarda pero no pisa ultimaLectura", async () => {
    const { tx, escrituras } = crearTx({
      [CICLO]: { etapaActual: "enjuague", ultimaLectura: { "wqs-lb-01": { ts: t(20) } } },
    });
    await transaccionIngesta(tx, datos(t(10)));
    expect(escrituras.some((e) => e.path === `${CICLO}/lecturas/L1`)).toBe(true);
    const cicloUpdate = escrituras.find((e) => e.path === CICLO);
    expect(tocaCampo(cicloUpdate, "ultimaLectura", "wqs-lb-01")).toBe(false);
    expect(tocaCampo(cicloUpdate, "variablesVistas", "wqs-lb-01")).toBe(true);
  });

  it("ciclo con etapaActual inválida: no escribe nada", async () => {
    const { tx, escrituras } = crearTx({ [CICLO]: { etapaActual: "otra" } });
    const r = await transaccionIngesta(tx, datos());
    expect(r).toMatchObject({ ok: false, codigo: 409 });
    expect(escrituras).toEqual([]);
  });

  it("ciclo inexistente: 404 sin escrituras", async () => {
    const { tx, escrituras } = crearTx({});
    expect(await transaccionIngesta(tx, datos())).toMatchObject({ ok: false, codigo: 404 });
    expect(escrituras).toEqual([]);
  });

  it("lectura ya guardada (reintento): duplicado, sin escrituras", async () => {
    const { tx, escrituras } = crearTx({
      [CICLO]: { etapaActual: "enjuague" }, [`${CICLO}/lecturas/L1`]: { ts: t(10) },
    });
    expect(await transaccionIngesta(tx, datos())).toEqual({ ok: true, etapa: "enjuague", duplicado: true });
    expect(escrituras).toEqual([]);
  });
});
