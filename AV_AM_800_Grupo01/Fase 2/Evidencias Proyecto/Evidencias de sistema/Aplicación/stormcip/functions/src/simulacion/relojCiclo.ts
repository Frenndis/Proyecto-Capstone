/**
 * Reloj del ciclo simulado (scripts/simulador-cip.js), con pausa ante atrasos.
 *
 * Si el equipo se suspende o el proceso se bloquea, al volver el bucle queda
 * atrasado. Recuperar ese tiempo dispararía en ráfaga los eventos pendientes
 * (uplinks con received_at casi iguales, etapas de 1 s), y deformaría lecturas
 * e indicadores. En vez de eso, el ciclo se PAUSA: se acumula el atraso en
 * `pausaS` y todo lo que viene se corre esa cantidad, como si la planta se
 * hubiera detenido y reanudado.
 *
 * Funciones puras (sin reloj del sistema): reciben `ahoraMs`, así se testean.
 */

/** Atraso tolerado antes de pausar: por debajo, el evento se ejecuta tarde y listo. */
export const TOLERANCIA_ATRASO_S = 5;

export type PlanEspera = {
  /** Cuánto esperar antes de ejecutar el evento (0 si ya es hora). */
  esperarMs: number;
  /** Pausa acumulada del ciclo, ya incluyendo la de este evento. */
  pausaS: number;
  /** Segundos que se pausaron en este evento (0 si no hubo pausa). */
  pausadoS: number;
};

/** Momento real (ms) en que corresponde un evento del ciclo en tModelo segundos. */
export function momentoReal(t0Ms: number, tModeloS: number, pausaS: number): number {
  return t0Ms + (tModeloS + pausaS) * 1000;
}

/**
 * Decide qué hacer con el próximo evento del ciclo: esperar, ejecutarlo ya o,
 * si va atrasado más de `toleranciaS`, pausar el ciclo por ese atraso. Tras la
 * pausa el evento queda "a tiempo" y los siguientes conservan su cadencia.
 */
export function planificarEspera(
  ahoraMs: number, t0Ms: number, tEventoS: number, pausaS: number,
  toleranciaS = TOLERANCIA_ATRASO_S,
): PlanEspera {
  const atrasoMs = ahoraMs - momentoReal(t0Ms, tEventoS, pausaS);
  if (atrasoMs > toleranciaS * 1000) {
    const pausadoS = atrasoMs / 1000;
    return { esperarMs: 0, pausaS: pausaS + pausadoS, pausadoS };
  }
  return { esperarMs: Math.max(0, -atrasoMs), pausaS, pausadoS: 0 };
}

/** Tiempo del modelo (s desde el inicio, sin las pausas), acotado al ciclo. */
export function tiempoModelo(ahoraMs: number, t0Ms: number, pausaS: number, totalS: number): number {
  return Math.min(Math.max((ahoraMs - t0Ms) / 1000 - pausaS, 0), totalS);
}
