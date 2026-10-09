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
  | {
      ok: true; lecturaId: string; alertas: number; descartadas: Record<string, string>;
      /** true = la lectura ya estaba guardada (reintento con ID determinista): no se escribió nada. */
      duplicado?: boolean;
    }
  | { ok: false; codigo: number; error: string };

/**
 * ID de alerta: una por ciclo + etapa + variable. Mientras la condición
 * persiste se actualiza el mismo documento en vez de crear uno por lectura.
 */
export function idAlerta(cicloId: string, etapa: string, variable: string): string {
  return `${cicloId}_${etapa}_${variable}`;
}

/** Lo que interesa de una alerta ya guardada para decidir cómo actualizarla. */
export type AlertaGuardada = {
  desde?: Timestamp; hasta?: Timestamp; conteo?: number; reconocida?: boolean;
};

export type CamposAlerta = {
  /** true = se reescribe el documento completo (sin merge): borra reconocidaPor/En del episodio anterior. */
  nuevoEpisodio: boolean;
  campos: {
    desde: Timestamp; hasta: Timestamp; conteo: number;
    ultimoValor?: number; reconocida?: false;
  };
};

/**
 * Campos de tiempo y estado de una alerta ante una lectura fuera de rango.
 *
 * - `desde` y `hasta` salen del mismo reloj: el `ts` de la lectura (antes `desde`
 *   era la hora del servidor y además se pisaba en cada repetición).
 * - Las lecturas pueden llegar desordenadas (reintentos de TTN, simulador que
 *   fecha hacia atrás): `desde` = mínimo y `hasta` = máximo de lo visto, y
 *   `ultimoValor` solo cambia si la lectura es la más reciente.
 * - Una alerta ya reconocida que vuelve a dispararse es un episodio nuevo.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function camposAlerta(
  existente: AlertaGuardada | undefined, ts: Timestamp, valor: number,
): CamposAlerta {
  if (!existente || existente.reconocida === true) {
    return {
      nuevoEpisodio: true,
      campos: { desde: ts, hasta: ts, ultimoValor: valor, conteo: 1, reconocida: false },
    };
  }
  const t = ts.toMillis();
  const desde = existente.desde && existente.desde.toMillis() <= t ? existente.desde : ts;
  const esLaMasReciente = !existente.hasta || t >= existente.hasta.toMillis();
  return {
    nuevoEpisodio: false,
    campos: {
      desde,
      hasta: esLaMasReciente ? ts : existente.hasta!,
      conteo: (existente.conteo ?? 0) + 1,
      ...(esLaMasReciente ? { ultimoValor: valor } : {}),
    },
  };
}

export type EventoAlerta = { id: string; valor: number; existente?: AlertaGuardada };

export type PlanEscritura =
  | { duplicado: true }
  | { duplicado: false; alertas: (CamposAlerta & { id: string })[] };

/**
 * Decide qué escribir dentro de la transacción de ingesta, a partir de lo leído.
 * Si la lectura ya existe (reintento con ID determinista) no se escribe nada:
 * repetirla volvería a contar `conteo` en las alertas.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function planificarEscritura(
  lecturaYaExiste: boolean, eventos: EventoAlerta[], ts: Timestamp,
): PlanEscritura {
  if (lecturaYaExiste) return { duplicado: true };
  return {
    duplicado: false,
    alertas: eventos.map((e) => ({ id: e.id, ...camposAlerta(e.existente, ts, e.valor) })),
  };
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

  // El ID se fija fuera de la transacción: si Firestore la reintenta por
  // contención, el reintento escribe el mismo documento y no uno nuevo.
  const lecturaRef = opts.lecturaId
    ? cicloRef.collection("lecturas").doc(opts.lecturaId)
    : cicloRef.collection("lecturas").doc();

  // 4. Alertas de proceso, deduplicadas por ciclo+etapa+variable
  const evaluables: Record<string, number> = { ...numericos, ...derivados };
  const disparadas = Object.entries(evaluables).flatMap(([v, valor]) => {
    const r = (rangos as any)[v];
    if (!fueraDeRango(valor, r)) return [];
    return [{ v, valor, r, ref: db.doc(`alertas/${idAlerta(cicloId, etapa, v)}`) }];
  });

  // Transacción (no batch): las alertas se escriben según su estado actual
  // (desde/hasta/conteo/reconocida). Si otra lectura toca la misma alerta entre
  // la lectura y la escritura, Firestore reintenta en vez de pisar `desde`.
  const plan = await db.runTransaction(async (tx) => {
    // Firestore exige hacer todas las lecturas antes de cualquier escritura
    const [lecturaSnap, ...alertaSnaps] = await tx.getAll(
      lecturaRef, ...disparadas.map((d) => d.ref),
    );
    const plan = planificarEscritura(
      lecturaSnap.exists,
      disparadas.map((d, i) => ({
        id: d.ref.id, valor: d.valor,
        existente: alertaSnaps[i].exists ? alertaSnaps[i].data() as AlertaGuardada : undefined,
      })),
      ts,
    );
    if (plan.duplicado) return plan;

    tx.set(lecturaRef, {
      v: ESQUEMA_VERSION, ts, etapa, deviceId,
      valores: limpios, derivados, metodo, confianza,
      ...extra,
    });

    // ultimaLectura anidada por dispositivo: dos equipos no se pisan entre sí
    tx.set(cicloRef, {
      etapaActual: etapa,
      ultimaLectura: { [deviceId]: { ts, valores: limpios, derivados } },
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });

    plan.alertas.forEach(({ nuevoEpisodio, campos }, i) => {
      const { v, r, ref } = disparadas[i];
      const datos = {
        cicloId, lineaId: ciclo.get("lineaId") ?? null, etapa, variable: v,
        min: r.min ?? null, max: r.max ?? null, severidad: "advertencia",
        ...campos,
      };
      // Episodio nuevo: documento completo, sin restos del reconocimiento anterior
      if (nuevoEpisodio) tx.set(ref, datos);
      else tx.set(ref, datos, { merge: true });
    });

    tx.update(db.doc(`dispositivos/${deviceId}`), {
      ultimoPing: FieldValue.serverTimestamp(),
    });
    return plan;
  });

  if (plan.duplicado) {
    return { ok: true, lecturaId: lecturaRef.id, alertas: 0, descartadas, duplicado: true };
  }
  return { ok: true, lecturaId: lecturaRef.id, alertas: plan.alertas.length, descartadas };
}
