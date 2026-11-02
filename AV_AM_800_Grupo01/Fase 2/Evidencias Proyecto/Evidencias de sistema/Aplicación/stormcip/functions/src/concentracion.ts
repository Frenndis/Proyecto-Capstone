// Concentración química (% de NaOH o ácido) inferida de la conductividad (EC) y
// la temperatura. Funciones puras, sin Firestore: los parámetros vienen de
// concentracionConfig.ts.
//
// La concentración no se mide directo; se infiere en 3 pasos:
//   1. Compensación por temperatura:  κ25 = κT / (1 + α·(T − 25))
//   2. Curva lineal de calibración:   % = (κ25 − b) / m      (κ25 en mS/cm)
//   3. Fase: si κ25 está bajo el umbral de agua, es enjuague y no se calcula.
//
// Es una capa aparte de `conductividad25C` (calculos.ts): usa el α de cada
// químico en vez del factor global y no modifica ese derivado. Si la lectura
// no es confiable (sonda saturada o fuera de operación) la concentración es
// null con confianza "baja" y el motivo.
import { Confianza, Etapa, ModeloSonda, TEMPERATURAS_LIQUIDO, Variable } from "./types";
import {
  CONFIG_CONCENTRACION_DEFECTO, ConfigConcentracion, QUIMICO_POR_ETAPA, Quimico,
  sensorYaCompensa,
} from "./concentracionConfig";

export type FaseQuimica = "soda" | "acido" | "agua";

/** "estimado": calculada con una curva de calibración aproximada. "baja": no se pudo calcular de forma confiable. */
export type ConfianzaQuimica = "estimado" | "baja";

/** Lo que se guarda en la lectura (campo `quimica`). null = no calculable; ver `motivo`. */
export type ResultadoQuimica = {
  fase: FaseQuimica;
  quimico: Quimico | null;
  /** κ25 en µS/cm (misma unidad que conductividad25C). */
  kappa25: number | null;
  /** % de químico. */
  concentracionQuimica: number | null;
  /** null en fase agua: no hay nada que calcular, no es una falta de confianza. */
  confianza: ConfianzaQuimica | null;
  /** Por qué no hay concentración (fase agua, sonda saturada, falta temperatura…). */
  motivo: string | null;
  /** Fórmula usada, con los parámetros aplicados. */
  metodo: string | null;
};

/** κ25 = κT / (1 + α·(T − 25)). Misma forma que compensarConductividad (calculos.ts), con el α que se le pase. */
export function compensarA25(kappaT: number, temp: number, alpha: number) {
  const factor = 1 + alpha * (temp - 25);
  return factor <= 0 ? kappaT : kappaT / factor;
}

/** % = (κ25 − b) / m, con κ25, b en mS/cm y m en mS/cm por 1 %. */
export const concentracionDesdeKappa = (kappa25MScm: number, m: number, b: number) =>
  (kappa25MScm - b) / m;

export type EntradaQuimica = {
  etapa: Etapa;
  /** Valores guardados de la lectura (conductividad en µS/cm, temperaturas en °C). */
  valores: Partial<Record<Variable, number>>;
  /** Confianza de cada variable medida (validarYLimpiarValores). */
  confianza?: Partial<Record<Variable, Confianza>>;
  /** Modelo de la sonda que mide la conductividad (para sensorYaCompensa). */
  modeloSonda?: ModeloSonda;
  config?: ConfigConcentracion;
};

const redondear = (n: number, d: number) => +n.toFixed(d);

export function calcularQuimica(e: EntradaQuimica): ResultadoQuimica {
  const cfg = e.config ?? CONFIG_CONCENTRACION_DEFECTO;
  const quimico = QUIMICO_POR_ETAPA[e.etapa];
  if (!quimico) {
    return {
      fase: "agua", quimico: null, kappa25: null, concentracionQuimica: null,
      confianza: null, motivo: `etapa sin químico (${e.etapa})`, metodo: null,
    };
  }
  const p = cfg.quimicos[quimico];
  const faseQuimica: FaseQuimica = quimico === "NaOH" ? "soda" : "acido";
  const sinCalculo = (motivo: string): ResultadoQuimica => ({
    fase: faseQuimica, quimico, kappa25: null, concentracionQuimica: null,
    confianza: "baja", motivo, metodo: null,
  });

  const ec = e.valores.conductividad;
  if (typeof ec !== "number") return sinCalculo("la lectura no trae conductividad");
  const confEc = e.confianza?.conductividad ?? "medido";
  if (confEc === "saturado") {
    return sinCalculo(`conductividad saturada (${ec} µS/cm): el valor real es mayor`);
  }
  if (confEc === "fuera_de_operacion") {
    return sinCalculo("conductividad fuera de operación (sonda sobre su temperatura máxima)");
  }

  // κ25: con sensorYaCompensa la EC ya viene a 25 °C y no se vuelve a compensar
  let kappa25: number;
  let compensacion: string;
  if (sensorYaCompensa(cfg, e.modeloSonda)) {
    kappa25 = ec;
    compensacion = `κ25 = EC (la sonda ${e.modeloSonda} ya compensa la temperatura)`;
  } else {
    // Misma preferencia de temperatura que derivarLectura: la propia sonda EC primero
    const tVar = TEMPERATURAS_LIQUIDO.find((k) => typeof e.valores[k] === "number");
    if (!tVar) return sinCalculo("falta la temperatura");
    const confT = e.confianza?.[tVar] ?? "medido";
    if (confT === "saturado") return sinCalculo(`temperatura saturada (${tVar})`);
    if (confT === "fuera_de_operacion") return sinCalculo(`temperatura fuera de operación (${tVar})`);
    const t = e.valores[tVar] as number;
    kappa25 = compensarA25(ec, t, p.alpha);
    compensacion = `κ25 = EC / (1 + ${p.alpha}·(T−25)), T=${t} °C (${tVar})`;
  }
  kappa25 = redondear(kappa25, 1);

  const kappaMS = kappa25 / 1000;
  if (kappaMS < p.umbralAguaMScm) {
    return {
      fase: "agua", quimico, kappa25, concentracionQuimica: null, confianza: null,
      motivo: `κ25 ${redondear(kappaMS, 3)} mS/cm bajo el umbral de agua (${p.umbralAguaMScm} mS/cm)`,
      metodo: compensacion,
    };
  }

  return {
    fase: faseQuimica, quimico, kappa25,
    concentracionQuimica: redondear(concentracionDesdeKappa(kappaMS, p.m, p.b), 3),
    confianza: "estimado", motivo: null,
    metodo: `${compensacion}; % = (κ25[mS/cm] − ${p.b}) / ${p.m} (curva de ejemplo, sin calibrar)`,
  };
}

// ── Fórmulas auxiliares (no se usan en la ingesta) ─────────────

/** Titulación de verificación: %NaOH (p/v) = V_HCl(mL) · N_HCl · 4 / V_muestra(mL). */
export const titulacionNaOH = (vHClmL: number, nHCl: number, vMuestramL: number) =>
  (vHClmL * nHCl * 4) / vMuestramL;

/**
 * Reposición de estanque: volumen de concentrado a agregar para llevar el
 * estanque de C_actual a C_objetivo: V_conc ≈ V_estanque · (C_obj − C_act) / (C_conc − C_obj).
 * null si el concentrado no es más fuerte que el objetivo (no se puede lograr).
 */
export function reposicionEstanque(
  vEstanque: number, cObjetivo: number, cActual: number, cConcentrado: number,
): number | null {
  if (cConcentrado <= cObjetivo) return null;
  return (vEstanque * (cObjetivo - cActual)) / (cConcentrado - cObjetivo);
}
