// Filtro de calidad + escritura. Compartido por ingestLectura (HTTP legado,
// ver http.ts) y ttnUplink (webhook LoRaWAN): ambos terminan acá.
import { getFirestore, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  Confianza, Derivado, ESQUEMA_VERSION, ETAPAS, ETAPAS_MONITOREADAS, Etapa, PARAMS_DEFECTO,
  ParamsCalculo, Rango, TEMPERATURAS_LIQUIDO, Umbrales, UltimaLectura, VARIABLES, Variable,
  Dispositivo, Sonda, fueraDeRango, sondaDe, specDe,
} from "./types";
import { derivarLectura } from "./calculos";

// null = "sensor no conectado" (centinela del DS18B20 externo, ver wqsDecoder):
// se guarda tal cual y se salta su validación de rango.
export type Limpios = Partial<Record<Variable, number | null>>;

/** Confianza de cada variable medida guardada (no incluye las null). */
export type ConfianzaValores = Partial<Record<Variable, Confianza>>;

export type ResultadoValidacion =
  | { ok: true; limpios: Limpios; confianza: ConfianzaValores; descartadas: Record<string, string> }
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
  | {
      duplicado: false;
      alertas: (CamposAlerta & { id: string })[];
      /** false = lectura atrasada: se guarda en `lecturas` pero no pisa `ultimaLectura`. */
      actualizarUltima: boolean;
    };

/**
 * Decide qué escribir dentro de la transacción de ingesta, a partir de lo leído.
 * Si la lectura ya existe (reintento con ID determinista) no se escribe nada:
 * repetirla volvería a contar `conteo` en las alertas.
 *
 * `ultimaTs` es el ts de ciclos/{id}.ultimaLectura.{deviceId}: una lectura
 * atrasada (reintento de TTN, datalog) no reemplaza a una más nueva. Con ts
 * igual sí, para que un reenvío corregido quede como la última.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function planificarEscritura(
  lecturaYaExiste: boolean, eventos: EventoAlerta[], ts: Timestamp, ultimaTs?: Timestamp,
): PlanEscritura {
  if (lecturaYaExiste) return { duplicado: true };
  return {
    duplicado: false,
    alertas: eventos.map((e) => ({ id: e.id, ...camposAlerta(e.existente, ts, e.valor) })),
    actualizarUltima: !ultimaTs || ts.toMillis() >= ultimaTs.toMillis(),
  };
}

/**
 * Valida y limpia los valores crudos: variable conocida, numérica o null, y
 * —si el equipo declara sondas— pertenencia y rango FÍSICO de fábrica:
 *
 *  - Bajo el mínimo físico: se DESCARTA esa variable (con su motivo). En las
 *    sondas del proyecto el mínimo es un piso físico (0 µS/cm, pH 0), así que
 *    un valor por debajo es falla de sensor, no una medición.
 *  - Sobre el máximo, según `satura` en CATALOGO_SONDAS:
 *    · variable que satura (conductividad, temperaturas de sonda): en el
 *      máximo o sobre él se guarda el máximo con confianza "saturado". Se usa
 *      ≥ porque una sonda que topa reporta justo su máximo.
 *    · variable que no satura (pH, DS18B20): sobre el máximo se DESCARTA
 *      como falla de sensor; justo en el máximo es un valor válido.
 *  - Si la temperatura de la propia sonda supera su tempMaxOperacion (o está
 *    saturada y no se sabe cuánto mide), la variable se guarda con confianza
 *    "fuera_de_operacion"; prevalece sobre "saturado".
 *
 * Un descarte no invalida la lectura completa: se pierde solo esa variable.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function validarYLimpiarValores(
  valoresCrudos: Record<string, unknown>,
  sondas?: Record<string, Sonda>,
): ResultadoValidacion {
  const limpios: Limpios = {};
  const confianza: ConfianzaValores = {};
  const descartadas: Record<string, string> = {};
  const conSondas = !!sondas && Object.keys(sondas).length > 0;

  // 1. Rango físico de cada variable
  for (const v of VARIABLES) {
    const n = valoresCrudos[v];
    if (n === undefined) continue;
    if (n === null) { limpios[v] = null; continue; }      // sensor no conectado
    if (typeof n !== "number" || !Number.isFinite(n)) {
      descartadas[v] = "no es un número finito";
      continue;
    }
    if (conSondas) {
      const spec = specDe(v, sondas);
      if (!spec) { descartadas[v] = "el equipo no tiene una sonda activa para esta variable"; continue; }
      if (n < spec.min) {
        descartadas[v] = `bajo el mínimo físico (${n} < ${spec.min} ${spec.unidad}): falla de sensor`;
        continue;
      }
      if (spec.satura && n >= spec.max) {
        limpios[v] = spec.max;
        confianza[v] = "saturado";
        continue;
      }
      if (!spec.satura && n > spec.max) {
        descartadas[v] = `sobre el máximo de escala (${n} > ${spec.max} ${spec.unidad}): falla de sensor`;
        continue;
      }
    }
    limpios[v] = n;
    confianza[v] = "medido";
  }

  // 2. Temperatura máxima de operación de cada sonda (necesita el paso 1 completo)
  if (conSondas) {
    const tempMedida = (t: Variable) => {
      const crudo = valoresCrudos[t];
      return typeof limpios[t] === "number" && typeof crudo === "number" ? crudo : undefined;
    };
    for (const v of Object.keys(confianza) as Variable[]) {
      const sonda = sondaDe(v, sondas);
      const tMax = sonda?.spec.tempMaxOperacion;
      if (!sonda || tMax === undefined) continue;
      // Sonda sin temperatura propia (turbidez): la mayor del líquido disponible
      const temps = sonda.temperatura ? [sonda.temperatura] : TEMPERATURAS_LIQUIDO;
      const fuera = temps.some((t) => {
        const c = tempMedida(t);
        return c !== undefined && (c > tMax || confianza[t] === "saturado");
      });
      if (fuera) confianza[v] = "fuera_de_operacion";
    }
  }

  if (Object.keys(limpios).length === 0) return { ok: false, error: "Sin variables válidas" };
  return { ok: true, limpios, confianza, descartadas };
}

export type AlertaDisparada = {
  /** Sufijo del ID: la variable, o `{variable}_saturacion`. */
  clave: string;
  variable: string;
  tipo: "umbral" | "saturacion";
  valor: number;
  confianza: Confianza;
  min: number | null;
  max: number | null;
};

/**
 * Qué alertas dispara una lectura ya validada.
 *
 *  - Umbral de proceso (configuracion/umbrales) sobre variables y derivados.
 *    Lo "fuera_de_operacion" no se evalúa. Un valor "saturado" es una cota
 *    inferior: solo puede violar con certeza un máximo, no un mínimo.
 *  - Saturación: en etapas monitoreadas, toda variable medida que llegó al
 *    tope de su sonda genera su propia alerta (documento aparte del umbral),
 *    con `max` = tope de la sonda.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function alertasDeLectura(opts: {
  etapa: string;
  numericos: Partial<Record<Variable, number>>;
  derivados: Partial<Record<Derivado, number>>;
  confianza: Partial<Record<Variable | Derivado, Confianza>>;
  rangos: Partial<Record<string, Rango>>;
  sondas?: Record<string, Sonda>;
}): AlertaDisparada[] {
  const { etapa, numericos, derivados, confianza, rangos, sondas } = opts;
  const out: AlertaDisparada[] = [];

  const evaluables: Record<string, number> = { ...numericos, ...derivados };
  for (const [v, valor] of Object.entries(evaluables)) {
    const conf = confianza[v as Variable | Derivado] ?? "medido";
    const r = rangos[v];
    if (!r || conf === "fuera_de_operacion") continue;
    if (!fueraDeRango(valor, conf === "saturado" ? { max: r.max } : r)) continue;
    out.push({
      clave: v, variable: v, tipo: "umbral", valor, confianza: conf,
      min: r.min ?? null, max: r.max ?? null,
    });
  }

  if ((ETAPAS_MONITOREADAS as string[]).includes(etapa)) {
    for (const [v, valor] of Object.entries(numericos) as [Variable, number][]) {
      if (confianza[v] !== "saturado") continue;
      out.push({
        clave: `${v}_saturacion`, variable: v, tipo: "saturacion", valor, confianza: "saturado",
        min: null, max: specDe(v, sondas)?.max ?? valor,
      });
    }
  }
  return out;
}

/**
 * Variables que la lectura demuestra que el equipo mide: las guardadas con
 * número, sus derivados y las descartadas por un valor inválido (la sonda
 * existe aunque esta vez fallara). No cuentan las null (sensor desconectado)
 * ni las descartadas por no tener sonda activa.
 *
 * Función pura (sin Firestore): se puede testear sin emulador.
 */
export function variablesVistasDe(
  limpios: Limpios, derivados: Partial<Record<Derivado, number>>,
  descartadas: Record<string, string>, sondas?: Record<string, Sonda>,
): string[] {
  const conSondas = !!sondas && Object.keys(sondas).length > 0;
  const vistas = new Set<string>();
  for (const [v, n] of Object.entries(limpios)) if (typeof n === "number") vistas.add(v);
  for (const v of Object.keys(derivados)) vistas.add(v);
  for (const v of Object.keys(descartadas)) {
    if ((VARIABLES as readonly string[]).includes(v) && (!conSondas || specDe(v as Variable, sondas))) {
      vistas.add(v);
    }
  }
  return [...vistas].sort();
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
  // Un descarte pierde un dato del equipo: queda en el log además de en la respuesta
  for (const [variable, motivo] of Object.entries(descartadas)) {
    console.warn("procesarLectura: variable descartada", {
      deviceId, variable, valor: valores[variable], motivo,
    });
  }

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
  const derivacion = derivarLectura(numericos, params, validacion.confianza);
  const { derivados, metodo } = derivacion;
  const confianza = { ...validacion.confianza, ...derivacion.confianza };

  // El ID se fija fuera de la transacción: si Firestore la reintenta por
  // contención, el reintento escribe el mismo documento y no uno nuevo.
  const lecturaRef = opts.lecturaId
    ? cicloRef.collection("lecturas").doc(opts.lecturaId)
    : cicloRef.collection("lecturas").doc();

  // 4. Alertas (umbral y saturación), deduplicadas por ciclo+etapa+clave
  const disparadas = alertasDeLectura({
    etapa, numericos, derivados, confianza, rangos, sondas: dispositivo.sondas,
  }).map((a) => ({ ...a, ref: db.doc(`alertas/${idAlerta(cicloId, etapa, a.clave)}`) }));
  const vistas = variablesVistasDe(limpios, derivados, descartadas, dispositivo.sondas);

  // Transacción (no batch): las alertas se escriben según su estado actual
  // (desde/hasta/conteo/reconocida). Si otra lectura toca la misma alerta entre
  // la lectura y la escritura, Firestore reintenta en vez de pisar `desde`.
  const plan = await db.runTransaction(async (tx) => {
    // Firestore exige hacer todas las lecturas antes de cualquier escritura
    // El ciclo se vuelve a leer DENTRO de la transacción: el ts de su
    // ultimaLectura decide si esta lectura la reemplaza, y otra ingesta
    // concurrente puede haberlo cambiado desde la lectura de arriba.
    const [lecturaSnap, cicloSnap, ...alertaSnaps] = await tx.getAll(
      lecturaRef, cicloRef, ...disparadas.map((d) => d.ref),
    );
    const ultimaTs = cicloSnap.get(new FieldPath("ultimaLectura", deviceId, "ts"));
    const plan = planificarEscritura(
      lecturaSnap.exists,
      disparadas.map((d, i) => ({
        id: d.ref.id, valor: d.valor,
        existente: alertaSnaps[i].exists ? alertaSnaps[i].data() as AlertaGuardada : undefined,
      })),
      ts,
      ultimaTs instanceof Timestamp ? ultimaTs : undefined,
    );
    if (plan.duplicado) return plan;

    tx.set(lecturaRef, {
      v: ESQUEMA_VERSION, ts, etapa, deviceId,
      valores: limpios, derivados, metodo, confianza,
      ...extra,
    });

    // ultimaLectura anidada por dispositivo: dos equipos no se pisan entre sí.
    // update con FieldPath reemplaza el mapa del dispositivo completo: un set
    // con merge mezclaría las `descartadas` de la lectura anterior. Una lectura
    // atrasada no la pisa (ni a etapaActual), pero sí suma a variablesVistas.
    const ultima: UltimaLectura = { ts, valores: limpios, derivados, confianza, descartadas };
    const camposUltima = plan.actualizarUltima
      ? [new FieldPath("ultimaLectura", deviceId), ultima, "etapaActual", etapa]
      : [];
    tx.update(
      cicloRef,
      new FieldPath("variablesVistas", deviceId), FieldValue.arrayUnion(...vistas),
      "actualizadoEn", FieldValue.serverTimestamp(),
      ...camposUltima,
    );

    plan.alertas.forEach(({ nuevoEpisodio, campos }, i) => {
      const { variable, tipo, min, max, confianza: confValor, ref } = disparadas[i];
      const datos = {
        cicloId, lineaId: ciclo.get("lineaId") ?? null, etapa, variable, tipo,
        min, max, severidad: "advertencia",
        ...campos,
        // Acompaña a ultimoValor: "saturado" = el valor real es ≥ ultimoValor
        ...("ultimoValor" in campos ? { confianza: confValor } : {}),
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
