// Proyección del fin de un enjuague: a partir de las lecturas de la etapa en
// curso, estima cuándo la conductividad llegará al criterio de agua limpia.
//
// Modelo: al desplazar el químico con agua, la conductividad cae de forma
// aproximadamente exponencial hacia la del agua de entrada:
//   C(t) = Cagua + A · e^(−t/τ)    →    ln(C − Cagua) = ln A − t/τ
// Es una recta, así que se ajusta por mínimos cuadrados y se despeja el instante
// en que C(t) = criterio. Se pondera por (C − Cagua)²: el logaritmo amplifica el
// ruido cerca del agua limpia, y sin el peso esas lecturas dominarían el ajuste.
//
// Es una estimación para informar al operador: no cambia el ciclo ni el PLC.
// Solo cuenta conductividad: un enjuague puede cumplirla sin estar validado.
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { Confianza, Etapa, PARAMS_DEFECTO, ParamsCalculo } from "./types";

/**
 * Solo los enjuagues con agua de red: el modelo supone que la curva baja hacia esa
 * conductividad. El preenjuague usa agua recuperada, que queda sobre ella, y se
 * proyectaría una hora de limpieza a la que nunca se llega.
 */
export const ETAPAS_PROYECCION: Etapa[] = ["enjuague", "enjuague_final"];

export const CONFIG_PROYECCION = {
  /** Con menos lecturas un salto de la señal se confunde con una caída. */
  minMuestras: 5,
  /**
   * Bajo este ajuste la curva no se comporta como un enjuague (saltos de la señal,
   * fallas), y no se informa un plazo. Valor calibrado con el modelo de simulación:
   * revisarlo con ciclos reales.
   */
  r2Minimo: 0.9,
  /** Una lectura a menos de esto (µS/cm) del agua no aporta: su logaritmo es casi todo ruido. */
  margenAguaUsCm: 1,
  /** Sobre este plazo (s) no se informa un número: en la práctica el enjuague no converge. */
  horizonteS: 2 * 3600,
  /** Fracción final de la caída que se ajusta: el fin del enjuague lo decide la cola, no el frente. */
  fraccionCola: 0.6,
  /** No se extrapola más de esto por el tiempo ya observado desde el máximo. */
  maxExtrapolacion: 3,
  /** Lecturas de cada uno de los dos tramos seguidos que comparan el estancamiento. */
  tramoEstancamiento: 3,
  /** Si la caída del último tramo es menos de esta fracción de la del anterior, la curva se estancó. */
  fraccionEstancamiento: 0.25,
  /** Lecturas de la etapa que lee el trigger en cada uplink. */
  limiteLecturas: 60,
};

export type MuestraEnjuague = {
  tMs: number;
  ec25: number;
  /** La sonda estaba en su tope: el valor real es mayor y no sirve para ajustar la curva. */
  saturada: boolean;
  turbidez?: number;
  /** La sonda de turbidez midió fuera de operación: ese criterio no es evaluable. */
  turbidezFuera?: boolean;
};

export type CriterioProyeccion = {
  cAguaUsCm: number;
  criterioEc25: number;
  criterioTurbidez: number;
};

export type ResultadoProyeccion =
  | { estado: "datos_insuficientes"; muestras: number }
  /** El criterio no supera al agua de entrada: la curva nunca lo alcanzaría. */
  | { estado: "sin_criterio"; muestras: number }
  /** La conductividad no cae de forma significativa, se estancó o no sigue una curva de enjuague. */
  | { estado: "no_converge"; muestras: number }
  /** La conductividad ya cumple, pero la turbidez todavía no. */
  | { estado: "turbidez_pendiente"; muestras: number }
  | { estado: "limpio"; muestras: number; limpioDesdeMs: number }
  | {
      estado: "proyectando"; muestras: number;
      limpioEnMs: number; restanteS: number; restanteMinS: number; restanteMaxS: number;
      tauS: number; r2: number;
    };

/** t de Student de dos colas al 95 %, por grados de libertad. */
export function tStudent95(gl: number): number {
  const tabla = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];
  if (gl <= 10) return tabla[Math.max(gl, 1) - 1];
  return gl <= 30 ? 2.09 : 1.96;
}

type Ajuste = { pendiente: number; xMedia: number; yMedia: number; sw: number; sxx: number; s2: number; r2: number };

/** Mínimos cuadrados ponderados de y sobre x. null si x no varía. */
function ajustar(puntos: { x: number; y: number; w: number }[]): Ajuste | null {
  const sw = puntos.reduce((s, p) => s + p.w, 0);
  const xMedia = puntos.reduce((s, p) => s + p.w * p.x, 0) / sw;
  const yMedia = puntos.reduce((s, p) => s + p.w * p.y, 0) / sw;
  const sxx = puntos.reduce((s, p) => s + p.w * (p.x - xMedia) ** 2, 0);
  if (!(sxx > 0)) return null;
  const pendiente = puntos.reduce((s, p) => s + p.w * (p.x - xMedia) * (p.y - yMedia), 0) / sxx;
  const sse = puntos.reduce((s, p) => s + p.w * (p.y - (yMedia + pendiente * (p.x - xMedia))) ** 2, 0);
  const sst = puntos.reduce((s, p) => s + p.w * (p.y - yMedia) ** 2, 0);
  const gl = puntos.length - 2;
  return {
    pendiente, xMedia, yMedia, sw, sxx,
    s2: gl > 0 ? sse / gl : 0,
    r2: sst > 0 ? 1 - sse / sst : 0,
  };
}

/** Función pura: sin Firestore, para poder testearla. */
export function proyectarEnjuague(
  muestras: MuestraEnjuague[], c: CriterioProyeccion, cfg = CONFIG_PROYECCION,
): ResultadoProyeccion {
  const validas = muestras.filter((m) => !m.saturada).sort((a, b) => a.tMs - b.tMs);
  const n = validas.length;
  if (c.criterioEc25 <= c.cAguaUsCm) return { estado: "sin_criterio", muestras: n };
  if (n === 0) return { estado: "datos_insuficientes", muestras: 0 };

  const ecCumple = (m: MuestraEnjuague) => m.ec25 <= c.criterioEc25;
  const cumple = (m: MuestraEnjuague) => ecCumple(m) && !m.turbidezFuera &&
    (m.turbidez === undefined || m.turbidez <= c.criterioTurbidez);

  const ultima = validas[n - 1];
  if (cumple(ultima)) {
    let i = n - 1;
    while (i > 0 && cumple(validas[i - 1])) i--;
    return { estado: "limpio", muestras: n, limpioDesdeMs: validas[i].tMs };
  }
  if (ecCumple(ultima)) return { estado: "turbidez_pendiente", muestras: n };

  // Al inicio de la etapa el químico aún viene llegando al retorno y la curva
  // sube: se ajusta solo desde el máximo, que es donde empieza la caída.
  const iMax = validas.reduce((mejor, m, i) => (m.ec25 > validas[mejor].ec25 ? i : mejor), 0);
  const t0 = validas[iMax].tMs;
  const caida = validas.slice(iMax)
    .filter((m) => m.ec25 - c.cAguaUsCm >= cfg.margenAguaUsCm)
    .map((m) => ({
      x: (m.tMs - t0) / 1000,
      y: Math.log(m.ec25 - c.cAguaUsCm),
      w: (m.ec25 - c.cAguaUsCm) ** 2,
    }));
  if (caida.length < cfg.minMuestras) return { estado: "datos_insuficientes", muestras: n };

  // Un enjuague real tiene dos fases: el frente de químico sale rápido y queda una
  // cola lenta. Ajustar toda la curva mezcla ambas y adelanta el instante proyectado.
  const puntos = caida.slice(-Math.max(cfg.minMuestras, Math.ceil(caida.length * cfg.fraccionCola)));
  const a = ajustar(puntos);
  if (!a) return { estado: "datos_insuficientes", muestras: n };

  // La caída debe ser significativa: si el intervalo de la pendiente incluye el
  // cero, la curva no se distingue de una línea plana con ruido.
  const margen = tStudent95(puntos.length - 2) * Math.sqrt(a.s2 / a.sxx);
  if (a.pendiente + margen >= 0 || a.r2 < cfg.r2Minimo) return { estado: "no_converge", muestras: n };

  // Una curva que se aplana sigue teniendo pendiente negativa, y sin este control
  // se proyectaría que limpia cuando en realidad se estancó.
  const tramo = cfg.tramoEstancamiento;
  if (caida.length >= tramo * 2) {
    const ultimo = ajustar(caida.slice(-tramo));
    const anterior = ajustar(caida.slice(-tramo * 2, -tramo));
    if (ultimo && anterior && anterior.pendiente < 0 &&
        ultimo.pendiente > anterior.pendiente * cfg.fraccionEstancamiento) {
      return { estado: "no_converge", muestras: n };
    }
  }

  // Recta inversa: instante en que la curva cruza el criterio, con su varianza
  // por el método delta (intervalo aproximado al 95 %).
  const yCriterio = Math.log(c.criterioEc25 - c.cAguaUsCm);
  const xCruce = a.xMedia + (yCriterio - a.yMedia) / a.pendiente;
  const xUltima = (ultima.tMs - t0) / 1000;
  const restanteS = Math.max(0, xCruce - xUltima);
  // El modelo supone que la curva baja hasta el agua de red. Si en realidad se
  // detiene antes (agua contaminada, fuga de químico), en un tramo corto se ve
  // igual que una caída lenta: por eso no se promete un plazo muy lejano.
  if (restanteS > cfg.horizonteS || restanteS > xUltima * cfg.maxExtrapolacion) {
    return { estado: "no_converge", muestras: n };
  }

  const varianza = (a.s2 / a.pendiente ** 2) * (1 / a.sw + (xCruce - a.xMedia) ** 2 / a.sxx);
  const mitad = tStudent95(puntos.length - 2) * Math.sqrt(varianza);
  return {
    estado: "proyectando", muestras: n,
    limpioEnMs: ultima.tMs + restanteS * 1000,
    restanteS: Math.round(restanteS),
    restanteMinS: Math.round(Math.max(0, restanteS - mitad)),
    restanteMaxS: Math.round(restanteS + mitad),
    tauS: +(-1 / a.pendiente).toFixed(1),
    r2: +a.r2.toFixed(3),
  };
}

/**
 * Muestra de un documento de lectura, o null si no sirve para proyectar: sin
 * EC25 (ni la sonda de conductividad fuera de operación, que no la calcula).
 */
export function muestraDeLectura(d: Record<string, any>): MuestraEnjuague | null {
  const ec25 = d.derivados?.conductividad25C;
  if (typeof ec25 !== "number" || !(d.ts instanceof Timestamp)) return null;
  const confianza = (d.confianza ?? {}) as Record<string, Confianza>;
  const turbidez = d.valores?.turbidez;
  return {
    tMs: d.ts.toMillis(),
    ec25,
    saturada: confianza.conductividad25C === "saturado",
    ...(typeof turbidez === "number" ? { turbidez } : {}),
    ...(confianza.turbidez === "fuera_de_operacion" ? { turbidezFuera: true } : {}),
  };
}

/** Lo que se guarda en ciclos/{id}.proyeccionEnjuague.{deviceId}. */
export function documentoProyeccion(etapa: Etapa, calculadaSobre: Timestamp, r: ResultadoProyeccion, c: CriterioProyeccion) {
  const base = { etapa, calculadaSobre, estado: r.estado, muestras: r.muestras };
  if (r.estado === "limpio") {
    return {
      ...base, limpioDesde: Timestamp.fromMillis(r.limpioDesdeMs), confianza: "medido",
      metodo: `última lectura cumple EC25 ≤ ${c.criterioEc25} µS/cm`,
    };
  }
  if (r.estado !== "proyectando") return base;
  return {
    ...base,
    limpioEn: Timestamp.fromMillis(Math.round(r.limpioEnMs)),
    restanteS: r.restanteS, restanteMinS: r.restanteMinS, restanteMaxS: r.restanteMaxS,
    tauS: r.tauS, r2: r.r2,
    confianza: "estimado",
    metodo: `caída exponencial hacia ${c.cAguaUsCm} µS/cm (agua de red) hasta EC25 ≤ ${c.criterioEc25} µS/cm; ` +
      "intervalo aproximado al 95 %",
  };
}

/**
 * Cada lectura nueva de un enjuague (ETAPAS_PROYECCION) recalcula la proyección de su
 * equipo. La escribe un trigger y no la transacción de ingesta para no sumarle
 * lecturas ni contención: si esto falla, la lectura ya quedó guardada. Un reintento
 * de TTN no llega aquí, porque la ingesta no reescribe una lectura duplicada.
 * Escribir en el ciclo no dispara nada más: alCerrarCiclo solo mira estado y recalcular.
 */
export const alCrearLectura = onDocumentCreated("ciclos/{cicloId}/lecturas/{lecturaId}", async (event) => {
  const d = event.data?.data();
  // Una lectura histórica (generar-historial.js) ya pasó: no hay nada que proyectar
  if (!d || d.historico || !ETAPAS_PROYECCION.includes(d.etapa) || !muestraDeLectura(d)) return;

  const db = getFirestore();
  const cicloRef = db.doc(`ciclos/${event.params.cicloId}`);
  // Se filtra en memoria: así no depende de un índice compuesto nuevo
  const [snap, cfg] = await Promise.all([
    cicloRef.collection("lecturas").orderBy("ts", "desc").limit(CONFIG_PROYECCION.limiteLecturas).get(),
    db.doc("configuracion/calculos").get(),
  ]);
  const p = { ...PARAMS_DEFECTO, ...(cfg.data() ?? {}) } as ParamsCalculo;
  const criterio: CriterioProyeccion = {
    cAguaUsCm: p.conductividadAguaRed,
    criterioEc25: p.criterioLimpio.conductividad25C,
    criterioTurbidez: p.criterioLimpio.turbidez,
  };
  const delTramo = snap.docs.map((doc) => doc.data()).filter((l) => l.etapa === d.etapa && l.deviceId === d.deviceId);
  const muestras = delTramo.map(muestraDeLectura).filter((m): m is MuestraEnjuague => m !== null);
  const ultimaTs = muestras.reduce((max, m) => Math.max(max, m.tMs), 0);

  await cicloRef.update(
    new FieldPath("proyeccionEnjuague", d.deviceId),
    documentoProyeccion(d.etapa, Timestamp.fromMillis(ultimaTs), proyectarEnjuague(muestras, criterio), criterio),
  );
});
