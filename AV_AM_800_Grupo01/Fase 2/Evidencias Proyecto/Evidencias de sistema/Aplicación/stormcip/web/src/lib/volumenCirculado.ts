// Lógica pura de la sección "Volumen circulado": qué filas mostrar y en qué
// estado está. Sin React ni Firestore, para poder testearla.
import { Ciclo, ETAPAS_MONITOREADAS, ETAPA_LABEL } from "./tipos";

/** Orden del ciclo CIP (mismo que ETAPAS del backend). */
export const ORDEN_ETAPAS = [
  "preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion",
];

export type FilaVolumen = {
  etapa: string; label: string;
  /** null: la etapa aún no tuvo lecturas. */
  litros: number | null;
  /** Enjuagues (azul) frente a etapas químicas (ámbar), como en la tendencia. */
  monitoreada: boolean;
};

export type EstadoVolumen =
  /** El equipo no informa caudal: no hay volumen que mostrar (no es "0 L"). */
  | { tipo: "sin_caudal" }
  /** Hay caudal pero el backend todavía no sumó nada. */
  | { tipo: "acumulando" }
  | { tipo: "listo"; filas: FilaVolumen[]; total: number; simulado: boolean; huecos: number };

/**
 * Estado de la sección. Sin `volumenCirculado` en el ciclo no se muestra 0 L:
 * o el caudal ya llega y se está acumulando (ciclo en curso), o no hay caudal.
 * La desinfección solo aparece si tiene volumen; el resto de las etapas siempre
 * (las que aún no corrieron, sin valor).
 */
export function estadoVolumen(
  vc: Ciclo["volumenCirculado"], caudalActual: number | undefined, enVivo: boolean,
): EstadoVolumen {
  const litros = vc?.litros ?? {};
  const conDatos = ORDEN_ETAPAS.filter((e) => typeof litros[e] === "number");
  if (conDatos.length === 0) {
    return enVivo && typeof caudalActual === "number" ? { tipo: "acumulando" } : { tipo: "sin_caudal" };
  }
  const filas: FilaVolumen[] = ORDEN_ETAPAS
    .filter((e) => e !== "desinfeccion" || (litros[e] ?? 0) > 0)
    .map((e) => ({
      etapa: e, label: ETAPA_LABEL[e] ?? e,
      litros: typeof litros[e] === "number" ? litros[e] : null,
      monitoreada: ETAPAS_MONITOREADAS.includes(e),
    }));
  // El total incluye la desinfección aunque no tenga fila (si tiene volumen, la tiene)
  const total = conDatos.reduce((s, e) => s + litros[e], 0);
  return { tipo: "listo", filas, total, simulado: vc?.simulado === true, huecos: vc?.huecos ?? 0 };
}

const entero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
/** "1.396 L" o "—" si la etapa no tiene valor. */
export const formatearLitros = (l: number | null) => (l === null ? "—" : `${entero.format(l)} L`);
