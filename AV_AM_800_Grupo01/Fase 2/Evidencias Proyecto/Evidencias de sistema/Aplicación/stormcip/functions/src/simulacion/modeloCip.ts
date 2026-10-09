/**
 * Modelo de un ciclo CIP para la demo (scripts/simulador-cip.js).
 *
 * Función pura: sin Firestore ni red. Dado un instante t (s desde el inicio del
 * ciclo) devuelve el estado de planta (lo que en la realidad vendría del PLC) y
 * lo que medirían las sondas del WQS-LB, que van en la línea de RETORNO.
 *
 * Determinista: el ruido sale de un hash de (semilla, canal, t), no de un
 * generador con estado, así que estadoEn(t) siempre devuelve lo mismo para el
 * mismo t aunque se llame en otro orden. Eso permite testearlo.
 *
 * La demo comprime el tiempo (~10×): una etapa real de varios minutos dura
 * decenas de segundos. Por eso las constantes de tiempo están en segundos de
 * demo y son cortas (p. ej. el arrastre químico se evacua en ~5 s).
 *
 * Escenario "normal": las curvas están ajustadas para que, con los uplinks
 * desfasados 5 s del inicio de cada etapa (instantesUplink), ninguna lectura de
 * las etapas monitoreadas cruce los umbrales de ALERTA de seed.js, y que el
 * enjuague final cruce el CRITERIO DE LIMPIEZA (200 µS/cm, más exigente que el
 * umbral de 300) a mitad de la etapa. En un ciclo real sí habría alertas
 * al inicio de cada enjuague por arrastre químico (ver modelo-datos-sensores.md).
 *
 * Escenario "falla": en el enjuague final la conductividad se estanca sobre el
 * umbral (como con agua de red contaminada o una válvula de químico con fuga):
 * se disparan alertas y no se alcanza criterioLimpio.
 *
 * Sondas: las del equipo comprado, DR-PH01 y DR-ECK1.0 (0–2000 µS/cm), sin
 * turbidez ni DS18B20. En los enjuagues la conductividad CRUDA queda bajo 2000;
 * en las etapas químicas la sonda satura y opera sobre 60 °C, y el backend lo
 * marca (saturado / fuera_de_operacion) en vez de descartarlo.
 */
import {
  DestinoRetorno, Etapa, EstadoFisico, OrigenCircuito, PARAMS_DEFECTO, ParamsCalculo,
} from "../types";
import { DatosWqsFPort2 } from "../wqsEncoder";

// ── Receta ─────────────────────────────────────────────────────
export type PasoReceta = { etapa: Etapa; duracionS: number };
export type Receta = PasoReceta[];
export type Escenario = "normal" | "falla";

/** Ciclo de 300 s para la presentación. Mismo orden que ETAPAS (types.ts). */
export const RECETA_DEFECTO: Receta = [
  { etapa: "preenjuague",    duracionS: 40 },
  { etapa: "alcalino",       duracionS: 70 },
  { etapa: "enjuague",       duracionS: 40 },
  { etapa: "acido",          duracionS: 60 },
  { etapa: "enjuague_final", duracionS: 60 },
  { etapa: "desinfeccion",   duracionS: 30 },
];

/** Duración mínima de etapa al escalar: el primer uplink va a los 5 s. */
export const DURACION_MIN_ETAPA_S = 6;

export function duracionReceta(receta: Receta): number {
  return receta.reduce((s, p) => s + p.duracionS, 0);
}

/**
 * Escala la receta a `totalS` segundos manteniendo las proporciones. La suma
 * queda exacta (el redondeo se absorbe en la última etapa).
 */
export function escalarReceta(receta: Receta, totalS: number): Receta {
  const base = duracionReceta(receta);
  const escalada = receta.map((p) => ({
    etapa: p.etapa, duracionS: Math.round((p.duracionS * totalS) / base),
  }));
  const resto = totalS - duracionReceta(escalada);
  escalada[escalada.length - 1].duracionS += resto;
  if (escalada.some((p) => p.duracionS < DURACION_MIN_ETAPA_S)) {
    throw new Error(
      `Duración ${totalS} s demasiado corta: alguna etapa quedaría bajo ${DURACION_MIN_ETAPA_S} s`,
    );
  }
  return escalada;
}

/** Etapa vigente en t (t fuera de rango se acota al ciclo). */
export function etapaEn(t: number, receta: Receta) {
  const total = duracionReceta(receta);
  const tc = Math.min(Math.max(t, 0), total);
  let inicio = 0;
  for (let i = 0; i < receta.length; i++) {
    const fin = inicio + receta[i].duracionS;
    if (tc < fin || i === receta.length - 1) {
      return { indice: i, etapa: receta[i].etapa, inicioS: inicio, duracionS: receta[i].duracionS, tE: tc - inicio };
    }
    inicio = fin;
  }
  throw new Error("receta vacía");
}

/**
 * Instantes de uplink: cada `cadaS` segundos, desfasados `desfaseS` del inicio
 * de CADA etapa. Así el primer uplink de un enjuague llega con el arrastre ya
 * evacuado y ningún uplink cae justo en un cambio de etapa.
 */
export function instantesUplink(receta: Receta, cadaS = 10, desfaseS = 5): number[] {
  const out: number[] = [];
  let inicio = 0;
  for (const p of receta) {
    for (let tE = desfaseS; tE < p.duracionS; tE += cadaS) out.push(inicio + tE);
    inicio += p.duracionS;
  }
  return out;
}

// ── Parámetros físicos (tamaño de demo) ────────────────────────
// Los caudales son reales (~18 m³/h) pero el tiempo está comprimido, así que
// los volúmenes son chicos: los estanques se dimensionan para que el cambio de
// nivel se vea en pantalla.
const CAPACIDAD_L = { soda: 1000, acido: 800, aguaRecuperada: 1000 };
const NIVEL_INICIAL = { soda: 85, acido: 80, aguaRecuperada: 60 };     // %
const RETENCION_CIRCUITO_L = 150;  // solución que queda en cañerías y estanque del camión
const TEMP_AMBIENTE = 15;
const RPM_NOMINAL = 2900;

const SODA = { conc: 1.8, temp: 78, ecPorPct: 45000 };   // % NaOH; °C; µS/cm a 25 °C por %
const ACIDO = { conc: 0.9, temp: 64, ecPorPct: 50000 };
const DESINF = { conc: 0.15, ec25: 700, ph: 3.5 };

const TAU_IDA = 3;      // s: la ida sigue a la consigna con poco retraso
const TAU_RETORNO = 6;  // s: el retorno (donde está el WQS) va más atrasado
// Pérdida de calor en la línea: el retorno queda algo bajo la consigna
const perdidaRetorno = (consigna: number) => 0.03 * (consigna - TEMP_AMBIENTE);

type PerfilEtapa = {
  origen: OrigenCircuito;
  consignaTemp: number;  // °C de ida en régimen
  concIda: number;       // % de químico en régimen
};

const PERFIL: Record<Etapa, PerfilEtapa> = {
  preenjuague:    { origen: "agua_recuperada", consignaTemp: 30,         concIda: 0 },
  alcalino:       { origen: "soda",            consignaTemp: SODA.temp,  concIda: SODA.conc },
  enjuague:       { origen: "agua_red",        consignaTemp: 18,         concIda: 0 },
  acido:          { origen: "acido",           consignaTemp: ACIDO.temp, concIda: ACIDO.conc },
  enjuague_final: { origen: "agua_red",        consignaTemp: 18,         concIda: 0 },
  desinfeccion:   { origen: "agua_red",        consignaTemp: 18,         concIda: DESINF.conc },
};

// Las etapas químicas mandan los primeros segundos al drenaje (el agua que
// empuja la solución); el enjuague final recupera solo cuando ya salió el ácido.
function destinoRetorno(etapa: Etapa, tE: number): DestinoRetorno {
  switch (etapa) {
    case "alcalino": case "acido": return tE < 4 ? "drenaje" : "recirculacion";
    case "enjuague_final": return tE < 5 ? "drenaje" : "recuperacion";
    default: return "drenaje";
  }
}

// ── Ruido determinista ─────────────────────────────────────────
// Hash entero (mulberry32 sobre una mezcla de semilla, canal y t en décimas).
function aleatorio(semilla: number, canal: number, t: number): number {
  let a = (semilla ^ Math.imul(canal + 1, 0x9e3779b1) ^ Math.imul(Math.round(t * 10), 0x85ebca6b)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let r = Math.imul(a ^ (a >>> 15), 1 | a);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;   // [0, 1)
}
/** Ruido en [-amp, amp]. */
const ruido = (semilla: number, canal: number, t: number, amp: number) =>
  (aleatorio(semilla, canal, t) * 2 - 1) * amp;

// ── Hidráulica ─────────────────────────────────────────────────
/** Fracción del caudal nominal: rampa de subida 3 s y de bajada 2 s. */
function fraccionCaudal(tE: number, duracion: number): number {
  return Math.max(0, Math.min(1, tE / 3, (duracion - tE) / 2));
}

/** Litros enviados desde el inicio de la etapa hasta tE (integral del caudal). */
function litrosEnviados(tE: number, duracion: number, caudalNominal: number): number {
  const lps = (caudalNominal * 1000) / 3600;
  const paso = 0.1;
  let litros = 0;
  for (let s = 0; s < tE; s += paso) {
    const ds = Math.min(paso, tE - s);
    litros += fraccionCaudal(s + ds / 2, duracion) * lps * ds;
  }
  return litros;
}

// ── Variables de calidad en el retorno (por etapa) ─────────────
type Calidad = { ec25: number; ph: number };

const relajar = (desde: number, hacia: number, tE: number, tau: number) =>
  hacia + (desde - hacia) * Math.exp(-tE / tau);

/**
 * pH a partir de la fracción de arrastre que queda. El exponente < 1 imita que
 * el pH (logarítmico) tarda más en volver a neutro que la conductividad.
 */
const phPorArrastre = (phAgua: number, phQuimico: number, fraccion: number) =>
  phAgua + (phQuimico - phAgua) * Math.pow(Math.max(0, Math.min(1, fraccion)), 0.35);

function calidadEtapa(
  etapa: Etapa, tE: number, previa: Calidad, ecRed: number, escenario: Escenario,
): Calidad {
  switch (etapa) {
    case "preenjuague":
      // Agua recuperada que arrastra el residuo de producto (leche). El primer
      // uplink (5 s) queda cerca de 1000 µS/cm, bajo el umbral de 1500.
      return {
        ec25: 300 + 1100 * Math.exp(-tE / 12),
        ph: 7.4 - 0.5 * Math.exp(-tE / 8),
      };
    case "alcalino": {
      // Frente de solución que llega al retorno
      const f = 1 - Math.exp(-tE / 2);
      return {
        ec25: previa.ec25 * (1 - f) + SODA.conc * SODA.ecPorPct * f,
        ph: phPorArrastre(previa.ph, 13.2, f),
      };
    }
    case "enjuague": {
      // Arrastre rápido (frente de soda) + cola lenta hacia el agua de red. El
      // primer uplink (5 s, ~43 °C) llega cerca de 1060 µS/cm a 25 °C y ~1450
      // crudo: bajo el umbral (1500) y bajo el tope de la DR-ECK1.0 (2000).
      const cola = 700;
      const rapido = Math.max(0, previa.ec25 - ecRed - cola);
      const ec25 = ecRed + rapido * Math.exp(-tE / 1.0) + cola * Math.exp(-tE / 8);
      const fr = (ec25 - ecRed) / Math.max(1, previa.ec25 - ecRed);
      return { ec25, ph: phPorArrastre(7.3, previa.ph, fr) };
    }
    case "acido": {
      const f = 1 - Math.exp(-tE / 2);
      return {
        ec25: previa.ec25 * (1 - f) + ACIDO.conc * ACIDO.ecPorPct * f,
        ph: phPorArrastre(previa.ph, 1.6, f),
      };
    }
    case "enjuague_final": {
      // Arrastre del ácido que sale muy rápido + cola lenta. En "normal" el primer
      // uplink (5 s) llega cerca de 280 µS/cm: sobre el criterio de limpieza
      // (200) pero bajo el umbral de alerta (300). La cola cruza 200 a mitad de
      // la etapa (~30 s). En "falla" se estanca sobre el umbral de alerta.
      const piso = escenario === "falla" ? 450 : ecRed;
      const cola = 142;
      const rapido = Math.max(0, previa.ec25 - piso - cola);
      const ec25 = piso + rapido * Math.exp(-tE / 0.6) + cola * Math.exp(-tE / 28.8);
      const fr = (ec25 - piso) / Math.max(1, previa.ec25 - piso);
      return { ec25, ph: phPorArrastre(7.2, previa.ph, fr) };
    }
    case "desinfeccion": {
      const f = 1 - Math.exp(-tE / 2);
      return {
        ec25: previa.ec25 * (1 - f) + DESINF.ec25 * f,
        ph: previa.ph + (DESINF.ph - previa.ph) * f,
      };
    }
  }
}

// ── Estado en t ────────────────────────────────────────────────
export type ParamsModelo = Pick<ParamsCalculo, "conductividadAguaRed" | "factorCompensacionEC" | "caudalNominalM3h"> & {
  semilla: number;
};

export const PARAMS_MODELO_DEFECTO: ParamsModelo = {
  conductividadAguaRed: PARAMS_DEFECTO.conductividadAguaRed,
  factorCompensacionEC: PARAMS_DEFECTO.factorCompensacionEC,
  caudalNominalM3h: PARAMS_DEFECTO.caudalNominalM3h,
  semilla: 2026,
};

/**
 * Lo que mediría el WQS-LB con DR-PH01 + DR-ECK1.0 (antes de cuantizar: eso lo
 * hace el encoder). `conductividad` es el valor real del líquido, sin el tope
 * de la sonda: el que recorta y marca "saturado" es el backend.
 */
export type LecturaSondas = {
  ph: number; tempSonda: number; conductividad: number; tempEc: number;
};

/** Máximo que cabe en el campo de 16 bits del payload (EC_K1 va sin divisor). */
const TOPE_16_BITS = 0xffff;

/**
 * Datos del uplink FPort 2 del equipo comprado: EC_K1 (DR-ECK1.0), pH
 * (DR-PH01) y el DS18B20 desconectado (centinela). La conductividad de las
 * etapas químicas (> 65 535 µS/cm) se acota a lo que cabe en el payload; igual
 * queda sobre el tope de la sonda, que es lo que el backend tiene que detectar.
 */
export function datosUplinkWqs(s: LecturaSondas, bateriaV: number): DatosWqsFPort2 {
  return {
    bateriaV, tempExterna: null,
    ecK1: Math.min(s.conductividad, TOPE_16_BITS), ecK1Temp: s.tempEc,
    ph: s.ph, phTemp: s.tempSonda,
  };
}

/** Unidades: aguaTotal y aguaRecuperada en m³; soda y acido en litros (ver Consumos en types.ts). */
export type ConsumosCalculados = { aguaTotal: number; aguaRecuperada: number; soda: number; acido: number };

export type ResultadoEstado = {
  estadoProceso: EstadoFisico;
  /** Segundos desde el inicio del ciclo en que empezó la etapa (el script lo pasa a Timestamp). */
  etapaInicioS: number;
  sondas: LecturaSondas;
  consumos: ConsumosCalculados;
};

// Estado acumulado al terminar cada etapa: temperaturas, calidad y volúmenes.
type Arrastre = { tempIda: number; tempRetorno: number; calidad: Calidad };

function estadoFinEtapa(
  p: PasoReceta, inicial: Arrastre, ecRed: number, escenario: Escenario,
): Arrastre {
  const perfil = PERFIL[p.etapa];
  const consignaRet = perfil.consignaTemp - perdidaRetorno(perfil.consignaTemp);
  return {
    tempIda: relajar(inicial.tempIda, perfil.consignaTemp, p.duracionS, TAU_IDA),
    tempRetorno: relajar(inicial.tempRetorno, consignaRet, p.duracionS, TAU_RETORNO),
    calidad: calidadEtapa(p.etapa, p.duracionS, inicial.calidad, ecRed, escenario),
  };
}

const redondear = (n: number, dec: number) => Math.round(n * 10 ** dec) / 10 ** dec;

export function estadoEn(
  t: number, receta: Receta = RECETA_DEFECTO, escenario: Escenario = "normal",
  params: ParamsModelo = PARAMS_MODELO_DEFECTO,
): ResultadoEstado {
  const total = duracionReceta(receta);
  const terminado = t >= total;
  const tc = Math.min(Math.max(t, 0), total);
  const actual = etapaEn(tc, receta);
  const ecRed = params.conductividadAguaRed;
  const qN = params.caudalNominalM3h;
  const s = params.semilla;

  // Recorre las etapas ya terminadas: arrastre de temperatura/calidad y volúmenes
  let arrastre: Arrastre = {
    tempIda: TEMP_AMBIENTE + 5, tempRetorno: TEMP_AMBIENTE + 5,
    calidad: { ec25: ecRed, ph: 7.2 },
  };
  const litros = { red: 0, recuperadaUsada: 0, recuperadaDevuelta: 0, soda: 0, acido: 0 };
  const sumarVolumenes = (p: PasoReceta, tE: number) => {
    const enviados = litrosEnviados(tE, p.duracionS, qN);
    const origen = PERFIL[p.etapa].origen;
    if (origen === "agua_red") litros.red += enviados;
    if (origen === "agua_recuperada") litros.recuperadaUsada += enviados;
    // El químico que queda retenido en el circuito se pierde al drenar el enjuague
    if (origen === "soda") litros.soda += Math.min(enviados, RETENCION_CIRCUITO_L);
    if (origen === "acido") litros.acido += Math.min(enviados, RETENCION_CIRCUITO_L);
    if (p.etapa === "enjuague_final" && tE > 5) {
      litros.recuperadaDevuelta += enviados - litrosEnviados(5, p.duracionS, qN);
    }
  };
  for (let i = 0; i < actual.indice; i++) {
    sumarVolumenes(receta[i], receta[i].duracionS);
    arrastre = estadoFinEtapa(receta[i], arrastre, ecRed, escenario);
  }
  sumarVolumenes(receta[actual.indice], actual.tE);

  const { etapa, tE, duracionS } = actual;
  const perfil = PERFIL[etapa];
  const consignaRet = perfil.consignaTemp - perdidaRetorno(perfil.consignaTemp);

  // Instrumentos de ida (PLC)
  const fq = terminado ? 0 : fraccionCaudal(tE, duracionS);
  const caudal = Math.max(0, qN * fq * (1 + ruido(s, 1, tc, 0.01)));
  const presion = fq > 0 ? 0.3 + 3.2 * fq * fq + ruido(s, 2, tc, 0.03) : 0;
  const tempIda = relajar(arrastre.tempIda, perfil.consignaTemp, tE, TAU_IDA) + ruido(s, 3, tc, 0.2);
  const concIda = perfil.concIda * (1 - Math.exp(-tE / 1.5));

  // Estanques
  const nivel = (inicialPct: number, capacidad: number, deltaL: number) =>
    Math.max(0, Math.min(100, inicialPct + (deltaL / capacidad) * 100));

  // Sondas en el retorno
  const tempRetorno = relajar(arrastre.tempRetorno, consignaRet, tE, TAU_RETORNO);
  const calidad = calidadEtapa(etapa, tE, arrastre.calidad, ecRed, escenario);
  const ec25 = calidad.ec25 * (1 + ruido(s, 4, tc, 0.015));
  const tempEc = tempRetorno + ruido(s, 5, tc, 0.2);
  // Conductividad cruda: inversa de la compensación de calculos.ts
  const conductividad = ec25 * (1 + params.factorCompensacionEC * (tempEc - 25));

  return {
    etapaInicioS: actual.inicioS,
    estadoProceso: {
      etapa,
      etapaDuracionS: duracionS,
      progresoEtapa: redondear(terminado ? 1 : tE / duracionS, 3),
      cicloDuracionS: total,
      transcurridoS: redondear(tc, 1),
      instrumentos: {
        tempIda: redondear(tempIda, 1),
        concentracion: redondear(concIda, 2),
        caudal: redondear(caudal, 2),
        presion: redondear(Math.max(0, presion), 2),
      },
      estanques: {
        soda: {
          nivel: redondear(nivel(NIVEL_INICIAL.soda, CAPACIDAD_L.soda, -litros.soda), 1),
          temp: redondear(SODA.temp + ruido(s, 6, tc, 0.2), 1),
          concentracion: redondear(SODA.conc + ruido(s, 7, tc, 0.02), 2),
        },
        acido: {
          nivel: redondear(nivel(NIVEL_INICIAL.acido, CAPACIDAD_L.acido, -litros.acido), 1),
          temp: redondear(ACIDO.temp + ruido(s, 8, tc, 0.2), 1),
          concentracion: redondear(ACIDO.conc + ruido(s, 9, tc, 0.01), 2),
        },
        aguaRecuperada: {
          nivel: redondear(nivel(
            NIVEL_INICIAL.aguaRecuperada, CAPACIDAD_L.aguaRecuperada,
            litros.recuperadaDevuelta - litros.recuperadaUsada,
          ), 1),
        },
      },
      circuito: {
        origen: perfil.origen,
        destinoRetorno: destinoRetorno(etapa, tE),
        bomba: { encendida: fq > 0, rpm: Math.round(RPM_NOMINAL * fq) },
      },
    },
    sondas: {
      ph: Math.max(0, Math.min(14, calidad.ph + ruido(s, 10, tc, 0.03))),
      tempSonda: tempRetorno - 0.3 + ruido(s, 12, tc, 0.2),
      conductividad: Math.max(0, conductividad),
      tempEc,
    },
    consumos: {
      aguaTotal: redondear(litros.red / 1000, 3),
      aguaRecuperada: redondear(litros.recuperadaUsada / 1000, 3),
      soda: redondear(litros.soda, 1),
      acido: redondear(litros.acido, 1),
    },
  };
}
