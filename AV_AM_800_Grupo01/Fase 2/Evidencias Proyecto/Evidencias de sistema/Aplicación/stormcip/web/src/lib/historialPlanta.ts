// Historial en el navegador de las variables que vienen del estado de planta
// (estadoProceso), no de las sondas. Ese documento se sobrescribe en cada tick y
// no guarda historia; para dibujar la tendencia de la concentración se acumulan
// las muestras que llegan mientras el dashboard está abierto. Sin React ni
// Firestore, para poder testearla.
import { EstadoProceso, Lectura } from "./tipos";

/** Variables que se grafican desde el estado de planta en vez de las lecturas de sondas. */
export const VARIABLES_DE_PLANTA = ["concentracion"];

/** Tope de muestras en memoria (~2 h a un tick cada 2 s). */
export const MAX_MUESTRAS = 3600;

export type HistorialPlanta = { cicloId: string; lecturas: Lectura[] };
export const HISTORIAL_VACIO: HistorialPlanta = { cicloId: "", lecturas: [] };

const msDe = (t: EstadoProceso["actualizadoEn"]) => (t?.toDate ? t.toDate().getTime() : null);

/**
 * Agrega la muestra de `planta` al historial del ciclo. Devuelve el MISMO objeto
 * si no cambia nada (muestra repetida, sin hora confirmada, otro ciclo sin datos),
 * para que quien lo guarda en estado no vuelva a renderizar.
 *
 * Las muestras tienen la forma de una Lectura para reutilizar el gráfico de
 * tendencia: `etapa` es la del estado de planta y `valores` lleva la concentración.
 */
export function agregarMuestra(
  hist: HistorialPlanta, cicloId: string, planta: EstadoProceso | null,
): HistorialPlanta {
  const reiniciado = hist.cicloId === cicloId ? hist : { cicloId, lecturas: [] };
  const ms = planta ? msDe(planta.actualizadoEn) : null;
  // serverTimestamp aún sin confirmar (null): se espera al siguiente snapshot
  if (!planta || ms === null) return reiniciado;

  const ultima = reiniciado.lecturas[reiniciado.lecturas.length - 1];
  if (ultima && msDe(ultima.ts) !== null && msDe(ultima.ts)! >= ms) return reiniciado;

  const muestra: Lectura = {
    id: `planta_${ms}`, ts: { toDate: () => new Date(ms) }, etapa: planta.etapa,
    deviceId: "planta", valores: { concentracion: planta.instrumentos.concentracion },
  };
  return { cicloId, lecturas: [...reiniciado.lecturas, muestra].slice(-MAX_MUESTRAS) };
}
