// Parámetros del cálculo de concentración química (concentracion.ts). Nada de
// esto va dentro de la lógica: se cambia aquí o, sin redesplegar, en
// configuracion/calculos.concentracion de Firestore (se mezcla sobre estos
// valores por campo, ver configConcentracion).
//
// ⚠ TODOS ESTOS NÚMEROS SON PLACEHOLDERS. Reemplazarlos cuando se tenga la
// curva real del proveedor de químicos (m y b) y se confirme el umbral de agua.
import type { Etapa, ModeloSonda } from "./types";

export type Quimico = "NaOH" | "acido";

export type ParamsQuimico = {
  /** Coeficiente de temperatura de la conductividad, por °C (0,019 = 1,9 %/°C). */
  alpha: number;
  /** Pendiente de la curva lineal: mS/cm por cada 1 % de concentración. */
  m: number;
  /** Ordenada de la curva lineal, en mS/cm. */
  b: number;
  /** κ25 (mS/cm) bajo el cual el líquido es agua/enjuague y no se calcula concentración. */
  umbralAguaMScm: number;
};

export type ConfigConcentracion = {
  quimicos: Record<Quimico, ParamsQuimico>;
  /**
   * ¿La sonda ya compensa la temperatura y entrega la EC a 25 °C? Si es true,
   * κ25 = EC reportada, sin aplicar la fórmula (si no, se compensaría dos veces).
   * Por modelo de sonda; sin entrada vale false.
   * ⚠ Sin confirmar: ver el punto 16 de Base de datos/PENDIENTES-DASHBOARD.md.
   */
  sensorYaCompensa: Partial<Record<ModeloSonda, boolean>>;
};

/** Químico de cada etapa. Las demás (enjuagues, desinfección) no tienen químico: fase agua. */
export const QUIMICO_POR_ETAPA: Partial<Record<Etapa, Quimico>> = {
  alcalino: "NaOH",
  acido: "acido",
};

export const CONFIG_CONCENTRACION_DEFECTO: ConfigConcentracion = {
  quimicos: {
    // NaOH 0,5–2 % a 70–80 °C. α ≈ 1,9 %/°C; ~50 mS/cm por 1 % (ejemplo, no calibrado).
    NaOH: { alpha: 0.019, m: 50, b: 0, umbralAguaMScm: 5 },
    // Ácido nítrico/fosfórico 0,5–1 %. Mismos números de ejemplo hasta tener la curva real.
    acido: { alpha: 0.019, m: 50, b: 0, umbralAguaMScm: 5 },
  },
  sensorYaCompensa: {
    "DR-ECK1.0": false,
    "DR-ECK10.0": false,
    "DR-EC200": false,
  },
};

const numero = (v: unknown, defecto: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : defecto;

/**
 * Mezcla lo guardado en Firestore (`configuracion/calculos.concentracion`) sobre
 * los valores por defecto, campo por campo. Un valor ausente o inválido (no
 * numérico, no booleano) se ignora y queda el de defecto: una edición manual
 * errónea no debe romper la ingesta.
 */
export function configConcentracion(crudo: unknown): ConfigConcentracion {
  const c = (crudo && typeof crudo === "object" ? crudo : {}) as {
    quimicos?: Partial<Record<Quimico, Partial<ParamsQuimico>>>;
    sensorYaCompensa?: Record<string, unknown>;
  };
  const d = CONFIG_CONCENTRACION_DEFECTO;
  const quimico = (q: Quimico): ParamsQuimico => ({
    alpha: numero(c.quimicos?.[q]?.alpha, d.quimicos[q].alpha),
    m: numero(c.quimicos?.[q]?.m, d.quimicos[q].m),
    b: numero(c.quimicos?.[q]?.b, d.quimicos[q].b),
    umbralAguaMScm: numero(c.quimicos?.[q]?.umbralAguaMScm, d.quimicos[q].umbralAguaMScm),
  });
  const sensorYaCompensa = { ...d.sensorYaCompensa };
  for (const [modelo, v] of Object.entries(c.sensorYaCompensa ?? {})) {
    if (typeof v === "boolean") sensorYaCompensa[modelo as ModeloSonda] = v;
  }
  return { quimicos: { NaOH: quimico("NaOH"), acido: quimico("acido") }, sensorYaCompensa };
}

export const sensorYaCompensa = (cfg: ConfigConcentracion, modelo?: ModeloSonda) =>
  modelo !== undefined && cfg.sensorYaCompensa[modelo] === true;
