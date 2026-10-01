// Filtro de calidad + escritura. Compartido por ingestLectura (HTTP legado)
// y ttnUplink (webhook LoRaWAN): ambos terminan en procesarLectura().
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  ESQUEMA_VERSION, Etapa, PARAMS_DEFECTO, ParamsCalculo, Umbrales,
  VARIABLES, Variable, Dispositivo, fueraDeRango, specDe,
} from "./types";
import { derivarLectura } from "./calculos";

export type ResultadoIngesta =
  | { ok: true; lecturaId: string; alertas: number; descartadas: Variable[] }
  | { ok: false; codigo: number; error: string };

export async function procesarLectura(opts: {
  deviceId: string; dispositivo: Dispositivo; cicloId: string; etapa: Etapa;
  valores: Record<string, unknown>; ts: Timestamp; lecturaId?: string;
}): Promise<ResultadoIngesta> {
  const db = getFirestore();
  const { deviceId, dispositivo, cicloId, etapa, valores, ts } = opts;

  // 1. Validación: variable conocida + numérica + dentro del rango FÍSICO
  //    de la sonda. Distinto de los umbrales de proceso (ver 3).
  const limpios: Partial<Record<Variable, number>> = {};
  const descartadas: Variable[] = [];
  for (const v of VARIABLES) {
    const n = (valores as any)[v];
    if (n === undefined || n === null) continue;
    if (typeof n !== "number" || !Number.isFinite(n)) { descartadas.push(v); continue; }
    const spec = specDe(v, dispositivo.sondas);
    if (spec && (n < spec.min || n > spec.max)) { descartadas.push(v); continue; }
    limpios[v] = n;
  }
  if (Object.keys(limpios).length === 0)
    return { ok: false, codigo: 400, error: "Sin variables válidas" };

  // 2. Ciclo + configuración
  const cicloRef = db.doc(`ciclos/${cicloId}`);
  const [ciclo, cfgU, cfgC] = await Promise.all([
    cicloRef.get(),
    db.doc("configuracion/umbrales").get(),
    db.doc("configuracion/calculos").get(),
  ]);
  if (!ciclo.exists) return { ok: false, codigo: 404, error: "Ciclo no existe" };

  const umbrales = (cfgU.data() ?? {}) as Umbrales;
  const params = { ...PARAMS_DEFECTO, ...(cfgC.data() ?? {}) } as ParamsCalculo;
  const rangos = umbrales[etapa] ?? {};

  // 3. Derivados (cálculo, no medición): cada uno declara método y confianza
  const { derivados, metodo, confianza } = derivarLectura(limpios, params);

  const batch = db.batch();
  const lecturaRef = opts.lecturaId
    ? cicloRef.collection("lecturas").doc(opts.lecturaId)   // id determinista → idempotente
    : cicloRef.collection("lecturas").doc();

  batch.set(lecturaRef, {
    v: ESQUEMA_VERSION, ts, etapa, deviceId,
    valores: limpios, derivados, metodo, confianza,
  });

  // ultimaLectura por dispositivo: dos equipos no se pisan entre sí
  batch.set(cicloRef, {
    etapaActual: etapa,
    ultimaLectura: { [deviceId]: { ts, valores: limpios, derivados } },
    actualizadoEn: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 4. Alertas de proceso, deduplicadas: una por ciclo+etapa+variable.
  //    Mientras la condición persiste se actualiza, no se crea otra.
  let alertas = 0;
  const evaluables: Record<string, number> = { ...limpios, ...derivados };
  for (const [v, valor] of Object.entries(evaluables)) {
    const r = (rangos as any)[v];
    if (!fueraDeRango(valor, r)) continue;
    const alertaId = `${cicloId}_${etapa}_${v}`;
    batch.set(db.doc(`alertas/${alertaId}`), {
      cicloId, lineaId: ciclo.get("lineaId") ?? null, etapa, variable: v,
      min: r.min ?? null, max: r.max ?? null, severidad: "advertencia",
      desde: FieldValue.serverTimestamp(), hasta: ts,
      ultimoValor: valor, conteo: FieldValue.increment(1), reconocida: false,
    }, { merge: true });
    alertas++;
  }

  batch.update(db.doc(`dispositivos/${deviceId}`), {
    ultimoPing: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { ok: true, lecturaId: lecturaRef.id, alertas, descartadas };
}
