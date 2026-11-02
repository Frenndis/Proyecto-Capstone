// Modelos por programa de lavado, calculados con los ciclos ya cerrados:
//  · Tiempo sugerido de cada enjuague: percentil 95 del tiempo hasta agua limpia
//    más un margen. Se usa el peor caso razonable y no el promedio, porque con el
//    promedio cerca de la mitad de los ciclos no alcanzaría a quedar limpia.
//  · Consumo esperado por ciclo: agua, soda y ácido, con su rango histórico y el
//    error que habría tenido la predicción en esos mismos ciclos (dejando uno fuera).
//
// Solo recomiendan: un cambio de receta lo aprueba calidad, con verificación de
// higiene, y se aplica por pasos. Nada de esto escribe en el ciclo ni en el PLC.
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { PARAMS_DEFECTO, ParamsCalculo } from "./types";
import { ETAPAS_PROYECCION } from "./proyeccionEnjuague";

export const CONFIG_MODELOS = {
  /** Ciclos válidos del programa antes de sugerir un tiempo. */
  minCiclosTiempo: 30,
  /** Margen de seguridad sobre el percentil 95. */
  margen: 0.1,
  /** Nunca se sugiere menos que esta fracción de lo configurado. */
  fraccionMinima: 0.5,
  /** Cada cambio de receta baja como máximo esta fracción. */
  fraccionPaso: 0.1,
  /** Sobre esta tasa de ciclos sin agua limpia, el programa no está estable. */
  maxTasaSinLimpiar: 0.05,
  /** Ciclos con consumo antes de predecirlo. */
  minCiclosConsumo: 5,
  /** Ciclos recientes de la línea que lee el trigger. */
  limiteCiclos: 200,
};

export function percentil(valores: number[], p: number): number {
  const orden = [...valores].sort((a, b) => a - b);
  // Rango más cercano: el resultado siempre es un valor que sí ocurrió
  return orden[Math.max(0, Math.ceil((p / 100) * orden.length) - 1)];
}

export type Recomendacion =
  | { estado: "faltan_ciclos"; ciclos: number; requeridos: number }
  | { estado: "sin_configuracion"; ciclos: number }
  | { estado: "inestable"; ciclos: number; tasaSinLimpiar: number }
  | { estado: "sin_ahorro"; ciclos: number; configuradoS: number; p95S: number }
  | {
      estado: "sugerencia"; ciclos: number; configuradoS: number; p95S: number;
      sugeridoS: number; siguientePasoS: number; ahorroAguaL: number; ahorroPasoL: number;
    };

/** `tiempos`: segundos hasta agua limpia por ciclo; null si ese ciclo no la alcanzó. */
export function recomendarEtapa(
  tiempos: (number | null)[], configuradoS: number | null, caudalM3h: number, cfg = CONFIG_MODELOS,
): Recomendacion {
  const ciclos = tiempos.length;
  if (ciclos < cfg.minCiclosTiempo) {
    return { estado: "faltan_ciclos", ciclos, requeridos: cfg.minCiclosTiempo };
  }
  if (!configuradoS) return { estado: "sin_configuracion", ciclos };

  const limpios = tiempos.filter((t): t is number => t !== null);
  const tasaSinLimpiar = (ciclos - limpios.length) / ciclos;
  if (tasaSinLimpiar > cfg.maxTasaSinLimpiar || limpios.length === 0) {
    return { estado: "inestable", ciclos, tasaSinLimpiar: +tasaSinLimpiar.toFixed(3) };
  }

  const p95S = percentil(limpios, 95);
  const sugeridoS = Math.ceil(Math.max(p95S * (1 + cfg.margen), configuradoS * cfg.fraccionMinima));
  if (sugeridoS >= configuradoS) return { estado: "sin_ahorro", ciclos, configuradoS, p95S };

  const siguientePasoS = Math.ceil(Math.max(sugeridoS, configuradoS * (1 - cfg.fraccionPaso)));
  const litrosPorS = (caudalM3h * 1000) / 3600;
  return {
    estado: "sugerencia", ciclos, configuradoS, p95S, sugeridoS, siguientePasoS,
    ahorroAguaL: Math.round((configuradoS - sugeridoS) * litrosPorS),
    ahorroPasoL: Math.round((configuradoS - siguientePasoS) * litrosPorS),
  };
}

export type PrediccionConsumo =
  | { estado: "faltan_ciclos"; ciclos: number; requeridos: number }
  | { estado: "listo"; ciclos: number; esperado: number; p10: number; p90: number; errorMedio: number };

const redondear = (n: number) => +n.toFixed(3);

/** Promedio del programa, con el error medio al predecir cada ciclo con los demás. */
export function predecirConsumo(valores: number[], cfg = CONFIG_MODELOS): PrediccionConsumo {
  const ciclos = valores.length;
  if (ciclos < cfg.minCiclosConsumo) {
    return { estado: "faltan_ciclos", ciclos, requeridos: cfg.minCiclosConsumo };
  }
  const suma = valores.reduce((s, v) => s + v, 0);
  const error = valores.reduce((s, v) => s + Math.abs(v - (suma - v) / (ciclos - 1)), 0) / ciclos;
  return {
    estado: "listo", ciclos,
    esperado: redondear(suma / ciclos),
    p10: redondear(percentil(valores, 10)),
    p90: redondear(percentil(valores, 90)),
    errorMedio: redondear(error),
  };
}

export type CicloParaModelo = {
  receta?: Record<string, number>;
  tiempoLimpio: Record<string, number | null>;
  consumos?: { aguaTotal?: number; soda?: number; acido?: number };
  simulado: boolean;
};

export function calcularModeloPrograma(ciclos: CicloParaModelo[], caudalM3h: number) {
  const etapas: Record<string, Recomendacion> = {};
  for (const etapa of ETAPAS_PROYECCION) {
    const conDato = ciclos.filter((c) => etapa in c.tiempoLimpio);
    const configurado = conDato.find((c) => c.receta?.[etapa])?.receta?.[etapa] ?? null;
    etapas[etapa] = recomendarEtapa(conDato.map((c) => c.tiempoLimpio[etapa]), configurado, caudalM3h);
  }
  const serie = (clave: "aguaTotal" | "soda" | "acido") =>
    ciclos.map((c) => c.consumos?.[clave]).filter((v): v is number => typeof v === "number");
  return {
    etapas,
    consumo: {
      aguaTotal: predecirConsumo(serie("aguaTotal")),
      soda: predecirConsumo(serie("soda")),
      acido: predecirConsumo(serie("acido")),
    },
    ciclos: ciclos.length,
    // La interfaz lo avisa: un modelo entrenado con simulación no demuestra ahorro real
    conDatosSimulados: ciclos.some((c) => c.simulado),
    caudalM3h,
  };
}

export function cicloParaModelo(d: Record<string, any>): CicloParaModelo {
  const tiempoLimpio: Record<string, number | null> = {};
  for (const etapa of ETAPAS_PROYECCION) {
    const indicadores = d.indicadoresPorEtapa?.[etapa];
    if (!indicadores) continue;   // sin lecturas de esa etapa no dice nada del tiempo
    const t = indicadores.derivados?.tiempoHastaLimpio;
    tiempoLimpio[etapa] = typeof t === "number" ? t : null;
  }
  return { receta: d.receta, tiempoLimpio, consumos: d.consumos, simulado: d.simulado === true };
}

/** La clave va como campo de Firestore: sin puntos ni caracteres de ruta. */
export const claveModelo = (lineaId: string, programa: string) =>
  `${lineaId}__${programa}`.replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * Corre cuando alCerrarCiclo deja los indicadores de un ciclo, y no al cerrarse,
 * porque el modelo los necesita. Escribe en configuracion/modelos, que todos los
 * roles pueden leer, así no hace falta tocar firestore.rules.
 */
export const alCalcularIndicadores = onDocumentUpdated("ciclos/{cicloId}", async (event) => {
  const antes = event.data?.before.get("indicadoresCalculadosEn") as Timestamp | undefined;
  const despues = event.data?.after;
  const calculados = despues?.get("indicadoresCalculadosEn") as Timestamp | undefined;
  if (!despues || !calculados || antes?.isEqual(calculados)) return;
  if (despues.get("estado") !== "finalizado") return;
  const { lineaId, programa } = despues.data() as { lineaId?: string; programa?: string };
  if (!lineaId || !programa) return;

  const db = getFirestore();
  const [snap, cfg] = await Promise.all([
    db.collection("ciclos").where("lineaId", "==", lineaId).orderBy("inicio", "desc")
      .limit(CONFIG_MODELOS.limiteCiclos).get(),
    db.doc("configuracion/calculos").get(),
  ]);
  const p = { ...PARAMS_DEFECTO, ...(cfg.data() ?? {}) } as ParamsCalculo;
  const ciclos = snap.docs.map((doc) => doc.data())
    .filter((c) => c.estado === "finalizado" && c.programa === programa && c.indicadoresCalculadosEn)
    .map(cicloParaModelo);

  const clave = claveModelo(lineaId, programa);
  await db.doc("configuracion/modelos").set({
    [clave]: {
      lineaId, programa, ...calcularModeloPrograma(ciclos, p.caudalNominalM3h),
      actualizadoEn: Timestamp.now(),
    },
  }, { mergeFields: [new FieldPath(clave)] });
});
