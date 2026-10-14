// Lógica pura de la barra de etapas y de los paneles de estado de planta.
// Sin React ni Firestore, para poder testearla.
import { ETAPAS_MONITOREADAS, EstadoProceso, MarcaTiempo } from "./tipos";

// Mismo orden que ETAPAS en functions/src/types.ts (etapas.test.ts lo compara).
export const ETAPAS_ORDEN = [
  "preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion",
] as const;

export type EstadoEtapa = "hecha" | "actual" | "pendiente";

/**
 * Estado de cada etapa de la barra. `etapaActual` es la que escribe quien maneja
 * el ciclo (operador, script director o simulador); un ciclo finalizado tiene
 * todas las etapas hechas. Una etapa desconocida deja todas pendientes en vez
 * de adivinar. `monitoreada` es false en las etapas químicas: las sondas WQS no
 * miden dentro de su rango físico y la web no calcula tendencia ni indicadores.
 */
export function estadoEtapas(
  etapaActual: string | undefined, estadoCiclo: string | undefined,
): { etapa: string; estado: EstadoEtapa; monitoreada: boolean }[] {
  const actual = ETAPAS_ORDEN.findIndex((e) => e === etapaActual);
  return ETAPAS_ORDEN.map((etapa, i) => ({
    etapa,
    monitoreada: ETAPAS_MONITOREADAS.includes(etapa),
    estado: estadoCiclo === "finalizado" ? "hecha"
      : actual === -1 ? "pendiente"
      : i < actual ? "hecha" : i === actual ? "actual" : "pendiente",
  }));
}

/** "05:07", o "1:05:07" desde la hora. null o negativo → "—". */
export function formatearDuracion(segundos: number | null | undefined) {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos) || segundos < 0) return "—";
  const total = Math.floor(segundos);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

/**
 * Segundos desde el inicio del ciclo: hasta `fin` si ya cerró, hasta ahora si no.
 * null si el inicio todavía no se conoce (serverTimestamp sin confirmar).
 */
export function segundosDelCiclo(
  inicio: MarcaTiempo | null | undefined, fin: MarcaTiempo | null | undefined, ahoraMs: number,
): number | null {
  if (!inicio?.toDate) return null;
  const hasta = fin?.toDate ? fin.toDate().getTime() : ahoraMs;
  return Math.max(0, (hasta - inicio.toDate().getTime()) / 1000);
}

/** estadoProceso solo vale para el ciclo que se está mostrando. */
export function procesoDelCiclo(proceso: EstadoProceso | null | undefined, cicloId: string | undefined) {
  return proceso && cicloId && proceso.cicloId === cicloId ? proceso : null;
}

/**
 * Tiempo en la etapa actual. El ciclo no guarda cuándo empezó cada etapa
 * (punto 11 de PENDIENTES-DASHBOARD.md): solo se conoce por `etapaInicio` de
 * estadoProceso, y únicamente si ese documento es del ciclo, está vigente, el
 * ciclo sigue en curso y ambas fuentes coinciden en la etapa. Si no, null.
 */
export function segundosEnEtapa(
  ciclo: { id: string; etapaActual?: string; estado?: string },
  proceso: EstadoProceso | null | undefined, detenido: boolean, ahoraMs: number,
): number | null {
  const p = procesoDelCiclo(proceso, ciclo.id);
  if (!p || detenido || ciclo.estado !== "en_curso" || p.estadoCiclo !== "en_curso") return null;
  if (p.etapa !== ciclo.etapaActual || !p.etapaInicio?.toDate) return null;
  return Math.max(0, (ahoraMs - p.etapaInicio.toDate().getTime()) / 1000);
}

/**
 * Tiempo restante de la etapa actual: la duración de la etapa que informa
 * estadoProceso menos el tiempo ya transcurrido en ella. Las duraciones solo
 * existen en ese documento (hoy las escribe el simulador): el ciclo no las
 * guarda. Mismas condiciones de vigencia que segundosEnEtapa; si no se cumplen, null.
 */
export function segundosRestantesEtapa(
  ciclo: { id: string; etapaActual?: string; estado?: string },
  proceso: EstadoProceso | null | undefined, detenido: boolean, ahoraMs: number,
): number | null {
  const enEtapa = segundosEnEtapa(ciclo, proceso, detenido, ahoraMs);
  const dur = proceso?.etapaDuracionS;
  if (enEtapa === null || typeof dur !== "number" || !(dur > 0)) return null;
  return Math.max(0, dur - enEtapa);
}

/**
 * Tiempo restante del ciclo: cicloDuracionS menos `transcurridoS` de estadoProceso
 * más lo que pasó desde que se escribió (el documento se actualiza cada pocos
 * segundos). transcurridoS ya descuenta las pausas del simulador. null si el
 * documento no es de este ciclo, no está vigente o el ciclo no está en curso.
 */
export function segundosRestantesCiclo(
  ciclo: { id: string; estado?: string },
  proceso: EstadoProceso | null | undefined, detenido: boolean, ahoraMs: number,
): number | null {
  const p = procesoDelCiclo(proceso, ciclo.id);
  if (!p || detenido || ciclo.estado !== "en_curso" || p.estadoCiclo !== "en_curso") return null;
  if (!(p.cicloDuracionS > 0) || typeof p.transcurridoS !== "number" || !p.actualizadoEn?.toDate) return null;
  const desdeEscritura = Math.max(0, (ahoraMs - p.actualizadoEn.toDate().getTime()) / 1000);
  return Math.max(0, p.cicloDuracionS - (p.transcurridoS + desdeEscritura));
}

export const ETIQUETA_ORIGEN: Record<string, string> = {
  soda: "Soda", acido: "Ácido", agua_red: "Agua de red", agua_recuperada: "Agua recuperada",
};
export const ETIQUETA_RETORNO: Record<string, string> = {
  recirculacion: "Recirculación", drenaje: "Drenaje", recuperacion: "Recuperación",
};
