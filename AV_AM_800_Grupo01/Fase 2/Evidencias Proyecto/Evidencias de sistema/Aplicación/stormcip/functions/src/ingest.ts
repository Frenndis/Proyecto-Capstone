// Filtro de calidad + escritura. Compartido por ingestLectura (HTTP legado,
// ver http.ts) y ttnUplink (webhook LoRaWAN): ambos terminan acá.
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  ESQUEMA_VERSION, ETAPAS, Etapa, PARAMS_DEFECTO, ParamsCalculo, Umbrales,
  VARIABLES, Variable, Dispositivo, Sonda, fueraDeRango, specDe,
} from "./types";
import { derivarLectura } from "./calculos";

// null = "sensor no conectado" (centinela del DS18B20 externo, ver wqsDecoder):
// se guarda tal cual y se salta su validación de rango.
export type Limpios = Partial<Record<Variable, number | null>>;

export type ResultadoValidacion =
  | { ok: true; limpios: Limpios; descartadas: Record<string, string> }
  | { ok: false; error: string };

export type ResultadoIngesta =
  | { ok: true; lecturaId: string; alertas: number; descartadas: Record<string, string> }
  | { ok: false; codigo: number; error: string };

/**
 * ID de alerta: una por ciclo + etapa + variable. Mientras la condición
 * persiste se actualiza el mismo documento en vez de crear uno por lectura.
 */
export function idAlerta(cicloId: string, etapa: string, variable: string): string {
  return `${cicloId}_${etapa}_${variable}`;
}

/**
 * Valida y limpia los valores crudos: variable conocida, numérica o null, y
 * —si el equipo declara sondas— pertenencia y rango FÍSICO de fábrica.
 *
 * Una variable fuera de rango se DESCARTA individualmente (con su motivo); no
 * invalida la lectura completa, para no perder lo que sí midieron las demás
 * sondas. Los descartes viajan en la respuesta para poder auditarlos.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function validarYLimpiarValores(
  valoresCrudos: Record<string, unknown>,
  sondas?: Record<string, Sonda>,
): ResultadoValidacion {
  const limpios: Limpios = {};
  const descartadas: Record<string, string> = {};

  for (const v of VARIABLES) {
    const n = valoresCrudos[v];
    if (n === undefined) continue;
    if (n === null) { limpios[v] = null; continue; }      // sensor no conectado
    if (typeof n !== "number" || !Number.isFinite(n)) {
      descartadas[v] = "no es un número finito";
      continue;
    }
    if (sondas && Object.keys(sondas).length) {
      const spec = specDe(v, sondas);
      if (!spec) { descartadas[v] = "el equipo no tiene una sonda activa para esta variable"; continue; }
      if (n < spec.min || n > spec.max) {
        descartadas[v] = `fuera de rango físico (${spec.min}–${spec.max} ${spec.unidad})`;
        continue;
      }
    }
    limpios[v] = n;
  }

  if (Object.keys(limpios).length === 0) return { ok: false, error: "Sin variables válidas" };
  return { ok: true, limpios, descartadas };
}

/**
 * Valida y escribe una lectura. NO autentica al caller: eso es responsabilidad
 * de quien la invoque (http.ts por API key, lorawanAdapter.ts por webhook).
 */
export async function procesarLectura(opts: {
  deviceId: string;
  dispositivo: Dispositivo;
  cicloId: string;
  etapa: string;
  valores: Record<string, unknown>;
  ts: Timestamp;
  /** ID determinista del doc (ej. `{devEui}_{tsSegundos}`) → idempotencia ante reintentos de TTN. */
  lecturaId?: string;
  /** Campos que se guardan en la lectura sin pasar por VARIABLES (ej. bateriaV, hex). */
  extra?: Record<string, unknown>;
}): Promise<ResultadoIngesta> {
  const db = getFirestore();
  const { deviceId, dispositivo, cicloId, etapa, valores, ts, extra } = opts;

  if (!ETAPAS.includes(etapa as Etapa)) {
    return { ok: false, codigo: 400, error: `Etapa inválida. Usar: ${ETAPAS.join(", ")}` };
  }

  // 1. Validación física (rango de la sonda), distinta de los umbrales de proceso (paso 4)
  const validacion = validarYLimpiarValores(valores, dispositivo.sondas);
  if (!validacion.ok) return { ok: false, codigo: 400, error: validacion.error };
  const { limpios, descartadas } = validacion;

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
  const rangos = umbrales[etapa as Etapa] ?? {};

  // Solo los numéricos entran al cálculo y a la evaluación de umbrales
  const numericos: Partial<Record<Variable, number>> = {};
  for (const [v, n] of Object.entries(limpios) as [Variable, number | null][]) {
    if (typeof n === "number") numericos[v] = n;
  }

  // 3. Derivados: cada uno declara método y confianza
  const { derivados, metodo, confianza } = derivarLectura(numericos, params);

  const batch = db.batch();
  const lecturaRef = opts.lecturaId
    ? cicloRef.collection("lecturas").doc(opts.lecturaId)
    : cicloRef.collection("lecturas").doc();

  batch.set(lecturaRef, {
    v: ESQUEMA_VERSION, ts, etapa, deviceId,
    valores: limpios, derivados, metodo, confianza,
    ...extra,
  });

  // ultimaLectura anidada por dispositivo: dos equipos no se pisan entre sí
  batch.set(cicloRef, {
    etapaActual: etapa,
    ultimaLectura: { [deviceId]: { ts, valores: limpios, derivados } },
    actualizadoEn: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 4. Alertas de proceso, deduplicadas por ciclo+etapa+variable.
  //    Nota: un reintento de TTN sobre la misma lectura vuelve a incrementar
  //    `conteo`. Es un contador de ocurrencias aproximado, no un conteo exacto
  //    de lecturas; se prefirió eso antes que un documento por lectura.
  let alertas = 0;
  const evaluables: Record<string, number> = { ...numericos, ...derivados };
  for (const [v, valor] of Object.entries(evaluables)) {
    const r = (rangos as any)[v];
    if (!fueraDeRango(valor, r)) continue;
    batch.set(db.doc(`alertas/${idAlerta(cicloId, etapa, v)}`), {
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
