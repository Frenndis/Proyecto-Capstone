import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import {
  VARIABLES, ETAPAS, Variable, Etapa, Umbrales, Sonda, EspecVariable, CATALOGO_SONDAS,
} from "./types";

type ResultadoIngesta = { status: number; body: Record<string, unknown> };

export type ResultadoValidacion =
  | { ok: true; limpios: Partial<Record<Variable, number | null>> }
  | { ok: false; error: string };

/**
 * Valida y limpia los valores crudos de una lectura: variable conocida, numérica
 * o `null`, y si el dispositivo declara `sondas` (unidad WQS-LB), pertenencia y
 * rango físico. Dispositivos sin `sondas` (ej. esp32-01) mantienen el
 * comportamiento anterior (solo variable conocida + numérica).
 *
 * `null` significa "sensor no conectado" (ej. el centinela del DS18B20 externo,
 * ver wqsDecoder.ts), no un dato inválido: se guarda tal cual y se saltan
 * pertenencia y rango para esa variable puntual.
 *
 * Función pura (sin Firestore) para poder testearla sin emulador.
 */
export function validarYLimpiarValores(
  valoresCrudos: Record<string, unknown>,
  sondas: Sonda[] | undefined,
): ResultadoValidacion {
  const limpios: Partial<Record<Variable, number | null>> = {};
  for (const v of VARIABLES) {
    const n = valoresCrudos[v];
    if (n === undefined) continue;
    if (n === null) { limpios[v] = null; continue; }
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { ok: false, error: `Valor inválido en ${v}` };
    }
    limpios[v] = n;
  }
  if (Object.keys(limpios).length === 0) {
    return { ok: false, error: "Sin variables válidas" };
  }

  if (sondas?.length) {
    const especPorVariable = new Map<Variable, EspecVariable>();
    for (const { modelo } of sondas) {
      for (const [v, espec] of Object.entries(CATALOGO_SONDAS[modelo])) {
        especPorVariable.set(v as Variable, espec as EspecVariable);
      }
    }
    for (const [v, n] of Object.entries(limpios) as [Variable, number | null][]) {
      if (n === null) continue;
      const espec = especPorVariable.get(v);
      if (!espec) {
        return { ok: false, error: `El dispositivo no tiene una sonda para "${v}"` };
      }
      if (n < espec.min || n > espec.max) {
        return { ok: false, error: `Valor de ${v} fuera de rango físico (${espec.min}–${espec.max} ${espec.unidad})` };
      }
    }
  }

  return { ok: true, limpios };
}

/**
 * ID determinista de una alerta a partir de la lectura que la disparó. Mismo
 * `lecturaId` + `variable` -> mismo ID siempre, para que un reintento de TTN
 * (misma lectura reprocesada) sobrescriba la alerta en vez de duplicarla.
 */
export function idAlerta(lecturaId: string, variable: string): string {
  return `${lecturaId}_${variable}`;
}

/**
 * Valida y escribe una lectura. No autentica al caller: eso es responsabilidad
 * de quien invoque esta función (ingestLectura por API key, ttnUplink por webhook).
 */
export async function procesarLectura(params: {
  dev: FirebaseFirestore.DocumentSnapshot;
  devRef: FirebaseFirestore.DocumentReference;
  cicloId: string;
  etapa: string;
  valoresCrudos: Record<string, unknown>;
  ts?: number;
  /** ID determinista del doc de lectura (ej. `{devEui}_{tsSegundos}`); si no viene, se autogenera. */
  lecturaId?: string;
  /** Campos que se guardan directo en la lectura sin pasar por `VARIABLES` (ej. bateriaV, hex). */
  extra?: Record<string, unknown>;
}): Promise<ResultadoIngesta> {
  const { dev, devRef, cicloId, etapa, valoresCrudos, ts, lecturaId, extra } = params;
  const db = getFirestore();

  if (!ETAPAS.includes(etapa as Etapa)) {
    return { status: 400, body: { error: `Etapa inválida. Usar: ${ETAPAS.join(", ")}` } };
  }

  const validacion = validarYLimpiarValores(valoresCrudos, dev.get("sondas") as Sonda[] | undefined);
  if (!validacion.ok) {
    return { status: 400, body: { error: validacion.error } };
  }
  const { limpios } = validacion;

  // Ciclo y umbrales de la etapa
  const cicloRef = db.doc(`ciclos/${cicloId}`);
  const [ciclo, cfg] = await Promise.all([cicloRef.get(), db.doc("configuracion/umbrales").get()]);
  if (!ciclo.exists) return { status: 404, body: { error: "Ciclo no existe" } };
  const umbrales = (cfg.get(etapa) ?? {}) as Umbrales;
  const momento = typeof ts === "number" ? Timestamp.fromMillis(ts) : Timestamp.now();

  // Escritura atómica: lectura + estado del ciclo + alertas
  const batch = db.batch();
  const lecturaRef = lecturaId
    ? cicloRef.collection("lecturas").doc(lecturaId)
    : cicloRef.collection("lecturas").doc();
  batch.set(lecturaRef, { ts: momento, etapa, deviceId: devRef.id, ...limpios, ...extra });
  batch.update(cicloRef, {
    etapaActual: etapa,
    ultimaLectura: { ts: momento, ...limpios },
    actualizadoEn: FieldValue.serverTimestamp(),
  });

  let alertas = 0;
  for (const [v, valor] of Object.entries(limpios) as [Variable, number | null][]) {
    if (valor === null) continue;
    const r = umbrales[v];
    if (!r) continue;
    const fuera = (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
    if (!fuera) continue;
    batch.set(db.collection("alertas").doc(idAlerta(lecturaRef.id, v)), {
      cicloId, lineaId: ciclo.get("lineaId") ?? null, etapa, variable: v, valor,
      min: r.min ?? null, max: r.max ?? null,
      severidad: "advertencia", ts: momento, reconocida: false,
    });
    alertas++;
  }
  batch.update(devRef, { ultimoPing: FieldValue.serverTimestamp() });
  await batch.commit();

  return { status: 201, body: { ok: true, lecturaId: lecturaRef.id, alertas } };
}

/**
 * POST /api/ingest   header: x-api-key
 * body: { deviceId, cicloId, etapa, ts?(ms), valores: { temperatura, caudal, ... } }
 * Punto de entrada para ESP32 / gateway / simulador que hablan HTTP directo.
 */
export const ingestLectura = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Usar POST" }); return; }

  const db = getFirestore();
  const { deviceId, cicloId, etapa, ts, valores } = req.body ?? {};
  const apiKey = req.get("x-api-key");

  if (!deviceId || !cicloId || !etapa || !valores || !apiKey) {
    res.status(400).json({ error: "Faltan campos: deviceId, cicloId, etapa, valores, x-api-key" });
    return;
  }

  // Autenticar dispositivo (se guarda solo el hash de la API key)
  const devRef = db.doc(`dispositivos/${deviceId}`);
  const dev = await devRef.get();
  const hash = createHash("sha256").update(apiKey).digest("hex");
  if (!dev.exists || dev.get("apiKeyHash") !== hash || dev.get("activo") === false) {
    res.status(401).json({ error: "Dispositivo no autorizado" });
    return;
  }

  const resultado = await procesarLectura({ dev, devRef, cicloId, etapa, valoresCrudos: valores, ts });
  res.status(resultado.status).json(resultado.body);
});
