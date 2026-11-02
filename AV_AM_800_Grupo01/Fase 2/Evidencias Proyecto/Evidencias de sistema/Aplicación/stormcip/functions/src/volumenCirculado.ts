// Volumen circulado por etapa: litros que pasaron por la línea en cada etapa del
// ciclo, integrando el caudal en el tiempo con la regla del trapecio.
//
//   V = Σ Q·Δt     entre dos lecturas consecutivas de la MISMA etapa
//   litros = (Q1 + Q2) / 2 [m³/h] · 1000/3600 · Δt [s]
//
// Es volumen CIRCULADO, no consumo: en las etapas de soda y ácido el líquido se
// recircula, así que lo que pasó por la línea no es lo que se gastó.
//
// Cómo llega el dato: `estadoProceso/{línea}` (lo que en la planta vendría del
// PLC) se sobrescribe completo en cada tick y no guarda historial. Este trigger
// recibe, en cada escritura, el documento ANTERIOR y el NUEVO: cada evento trae
// su propio intervalo, y el resultado se acumula en `ciclos/{id}.volumenCirculado`
// (solo campos agregados, sin historial de muestras).
//
// Orden y duplicados: Firestore entrega los eventos al menos una vez y SIN
// garantía de orden. Por eso:
//  · El intervalo de un evento depende solo de su par (anterior, nuevo), no del
//    orden en que llegue, y la suma es conmutativa: eventos desordenados dan el
//    mismo total. No se guarda la "última muestra" (un evento atrasado parecería
//    viejo y se perdería su volumen).
//  · Los duplicados se descartan con el ID del evento: un marcador por evento en
//    `ciclos/{id}/eventosVolumen/{eventId}`, creado en la MISMA transacción que
//    la suma, así que un evento se cuenta exactamente una vez.
//
// Pérdida en los bordes de etapa (aceptada): el intervalo entre la última lectura
// de una etapa y la primera de la siguiente tiene etapas distintas, así que no se
// cuenta. Con el simulador (tick de 2 s, el caudal baja a ~0 al final de cada
// etapa) medido sobre la receta de 300 s (1425 L exactos):
//   · 5,4–6,1 L por etapa en las cinco primeras: 1,7–3,2 % de cada una;
//   · 0,8 L (0,55 %) en la última, porque el cierre del ciclo sí cuenta su
//     último intervalo (es de la misma etapa);
//   · total del ciclo: 1395,6 L, 29,4 L (2,1 %) bajo lo exacto.
// Con un PLC que informe más seguido la pérdida baja en proporción. Repartir ese
// intervalo con `etapaInicio` daría el valor exacto, pero no se hace: la regla
// "entre lecturas consecutivas de la misma etapa" es simple y auditable.
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { DocumentReference, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { ETAPAS, Etapa } from "./types";

export const CONFIG_VOLUMEN = {
  /**
   * Intervalo máximo (s) entre dos lecturas para integrarlo. Más que esto es
   * un PLC caído: no se suma (inflaría el volumen) y se cuenta como hueco.
   * Ajustar a la cadencia real del PLC (el simulador escribe cada 2 s).
   */
  huecoMaxS: 30,
  /** Días hasta que vence cada marcador de evento (campo `expiraEn`, para una política TTL de Firestore). */
  retencionMarcadoresDias: 30,
};

/** Lo que se necesita de una lectura de estadoProceso. */
export type MuestraProceso = {
  cicloId: string; etapa: string; estadoCiclo: string;
  /** m³/h */
  caudalM3h: number;
  tsMs: number; simulado: boolean;
};

/** Lo guardado en ciclos/{id}.volumenCirculado. */
export type VolumenCirculado = {
  /** Litros por etapa; una etapa sin lecturas aún no tiene entrada. */
  litros: Partial<Record<Etapa, number>>;
  /** Intervalos descartados por ser demasiado largos (PLC caído). */
  huecos: number;
  /** true si el estado de planta viene del simulador. */
  simulado: boolean;
};

export type Intervalo =
  | { tipo: "suma"; cicloId: string; etapa: Etapa; litros: number; simulado: boolean }
  | { tipo: "hueco"; cicloId: string; etapa: Etapa; simulado: boolean }
  | { tipo: "omitido"; motivo: string };

type Marca = { toMillis?: () => number; toDate?: () => Date } | null | undefined;
const msDe = (t: Marca) =>
  t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : null;

/**
 * Muestra de un documento de estadoProceso, o null si no trae lo necesario
 * (sin caudal, sin hora confirmada o sin ciclo): un equipo sin caudalímetro no
 * suma nada, y el dashboard lo muestra como "Sin caudal".
 */
export function muestraDe(d: Record<string, any> | undefined): MuestraProceso | null {
  if (!d) return null;
  const caudal = d.instrumentos?.caudal;
  const tsMs = msDe(d.actualizadoEn);
  if (typeof caudal !== "number" || !Number.isFinite(caudal) || caudal < 0) return null;
  if (tsMs === null || typeof d.cicloId !== "string" || typeof d.etapa !== "string") return null;
  return {
    cicloId: d.cicloId, etapa: d.etapa, estadoCiclo: String(d.estadoCiclo),
    caudalM3h: caudal, tsMs, simulado: d.simulado === true,
  };
}

/** Regla del trapecio: litros entre dos caudales (m³/h) separados dtS segundos. */
export const litrosTrapecio = (q1M3h: number, q2M3h: number, dtS: number) =>
  ((q1M3h + q2M3h) / 2) * (1000 / 3600) * dtS;

/** Qué aporta el par (muestra anterior, muestra nueva) de un evento. */
export function intervaloVolumen(
  antes: MuestraProceso | null, despues: MuestraProceso | null, cfg = CONFIG_VOLUMEN,
): Intervalo {
  if (!antes || !despues) return { tipo: "omitido", motivo: "falta caudal u hora en una de las muestras" };
  if (antes.cicloId !== despues.cicloId) return { tipo: "omitido", motivo: "muestras de ciclos distintos" };
  // Con el ciclo cerrado la bomba está apagada: no se suma nada más
  if (antes.estadoCiclo !== "en_curso") return { tipo: "omitido", motivo: "el ciclo ya no estaba en curso" };
  if (antes.etapa !== despues.etapa) return { tipo: "omitido", motivo: "cambio de etapa (borde, no se cuenta)" };
  if (!(ETAPAS as readonly string[]).includes(antes.etapa)) return { tipo: "omitido", motivo: `etapa inválida (${antes.etapa})` };
  const etapa = antes.etapa as Etapa;
  const simulado = antes.simulado || despues.simulado;

  const dtS = (despues.tsMs - antes.tsMs) / 1000;
  if (dtS <= 0) return { tipo: "omitido", motivo: "intervalo no positivo" };
  if (dtS > cfg.huecoMaxS) return { tipo: "hueco", cicloId: antes.cicloId, etapa, simulado };
  return {
    tipo: "suma", cicloId: antes.cicloId, etapa, simulado,
    litros: litrosTrapecio(antes.caudalM3h, despues.caudalM3h, dtS),
  };
}

/** Suma un intervalo al agregado del ciclo (función pura: no modifica `actual`). */
export function acumular(
  actual: VolumenCirculado | undefined, i: Exclude<Intervalo, { tipo: "omitido" }>,
): VolumenCirculado {
  const litros = { ...(actual?.litros ?? {}) };
  if (i.tipo === "suma") litros[i.etapa] = (litros[i.etapa] ?? 0) + i.litros;
  return {
    litros, huecos: (actual?.huecos ?? 0) + (i.tipo === "hueco" ? 1 : 0),
    simulado: i.simulado,
  };
}

/** Lo mínimo de una Transaction de Firestore que usa el trigger (los tests lo simulan). */
export type TxVolumen = Pick<Transaction, "getAll" | "set" | "update">;

export type ResultadoVolumen = "sumado" | "hueco" | "duplicado" | "sin_ciclo";

/**
 * Cuerpo de la transacción: el marcador del evento y la suma al ciclo se
 * escriben juntos, o ninguno. Si el marcador ya existe, el evento ya se contó.
 */
export async function transaccionVolumen(
  tx: TxVolumen,
  d: {
    eventId: string; cicloRef: DocumentReference; marcadorRef: DocumentReference;
    intervalo: Exclude<Intervalo, { tipo: "omitido" }>; ahoraMs: number; cfg?: typeof CONFIG_VOLUMEN;
  },
): Promise<ResultadoVolumen> {
  const cfg = d.cfg ?? CONFIG_VOLUMEN;
  // Firestore exige hacer todas las lecturas antes de cualquier escritura
  const [marcador, ciclo] = await tx.getAll(d.marcadorRef, d.cicloRef);
  if (marcador.exists) return "duplicado";
  if (!ciclo.exists) return "sin_ciclo";

  tx.set(d.marcadorRef, {
    eventId: d.eventId, tipo: d.intervalo.tipo, etapa: d.intervalo.etapa,
    litros: d.intervalo.tipo === "suma" ? d.intervalo.litros : null,
    creadoEn: Timestamp.fromMillis(d.ahoraMs),
    expiraEn: Timestamp.fromMillis(d.ahoraMs + cfg.retencionMarcadoresDias * 86_400_000),
  });
  tx.update(d.cicloRef, {
    volumenCirculado: acumular(ciclo.get("volumenCirculado") as VolumenCirculado | undefined, d.intervalo),
  });
  return d.intervalo.tipo === "suma" ? "sumado" : "hueco";
}

/** El ID del evento va en la ruta del marcador: sin "/" ni espacios. */
export const idMarcador = (eventId: string) => eventId.replace(/[^A-Za-z0-9_.-]/g, "_");

/**
 * Cada escritura de estadoProceso/{línea} aporta su intervalo al volumen del
 * ciclo. Las creaciones y borrados no tienen par (anterior, nuevo) y se ignoran.
 */
export const alCambiarEstadoProceso = onDocumentWritten("estadoProceso/{lineaId}", async (event) => {
  const cambio = event.data;
  if (!cambio?.before.exists || !cambio.after.exists) return;

  const intervalo = intervaloVolumen(muestraDe(cambio.before.data()), muestraDe(cambio.after.data()));
  if (intervalo.tipo === "omitido") return;

  const db = getFirestore();
  const cicloRef = db.doc(`ciclos/${intervalo.cicloId}`);
  const marcadorRef = cicloRef.collection("eventosVolumen").doc(idMarcador(event.id));
  const r = await db.runTransaction((tx) =>
    transaccionVolumen(tx, { eventId: event.id, cicloRef, marcadorRef, intervalo, ahoraMs: Date.now() }));
  if (r === "sin_ciclo") {
    console.warn("alCambiarEstadoProceso: el ciclo no existe", { cicloId: intervalo.cicloId, eventId: event.id });
  }
});
