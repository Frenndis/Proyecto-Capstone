// Serie de la tendencia: puntos (tiempo real en ms, valor) de UN ciclo, con un
// corte en la línea donde hay un hueco grande entre lecturas. Sin React ni
// Firestore, para poder testearla.
import { Lectura, valorDe } from "./tipos";

export type PuntoSerie = { t: number; valor: number | null };

export type Serie = {
  puntos: PuntoSerie[];
  /** Límites del eje X: del inicio del ciclo (o la primera lectura si es anterior) al fin/ahora. */
  desdeMs: number;
  hastaMs: number;
  /** Cuántos cortes se insertaron. */
  huecos: number;
};

/**
 * Un hueco es un intervalo mayor que FACTOR_HUECO veces la mediana de los
 * intervalos entre lecturas. Con la mediana el umbral se adapta solo a la
 * cadencia del equipo (10 s en la demo, 20 min en terreno).
 */
export const FACTOR_HUECO = 3;
/** Con menos puntos que esto no hay cadencia que comparar y no se corta nada. */
export const MIN_PUNTOS_PARA_HUECOS = 4;

export function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m] : (orden[m - 1] + orden[m]) / 2;
}

/** Marca de Firestore (o null) → ms. */
const aMs = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().getTime() : null;

/**
 * Arma la serie de `variable` con las lecturas del ciclo mostrado.
 *
 *  - Solo puntos con valor numérico (medido o derivado, como valorDe).
 *  - Ordenados por tiempo; el eje X es el tiempo real, no el índice de lectura.
 *  - Entre dos lecturas con un intervalo > FACTOR_HUECO × mediana se inserta un
 *    punto sin valor: la línea se corta en vez de unir con un tramo recto que
 *    parecería una medición.
 *  - Eje X desde `inicioMs` hasta `finMs`; si falta alguno se usa la primera /
 *    última lectura. Una lectura anterior al inicio extiende el eje, no se pierde.
 */
export function construirSerie(
  lecturas: Pick<Lectura, "ts" | "valores" | "derivados">[], variable: string,
  { inicioMs, finMs }: { inicioMs?: number | null; finMs?: number | null } = {},
): Serie {
  const base = lecturas
    .map((l) => ({ t: aMs(l.ts), v: valorDe(l, variable) }))
    .filter((x): x is { t: number; v: number } => x.t !== null && typeof x.v === "number")
    .sort((a, b) => a.t - b.t);

  const puntos: PuntoSerie[] = [];
  const intervalos = base.slice(1).map((p, i) => p.t - base[i].t);
  const med = base.length >= MIN_PUNTOS_PARA_HUECOS ? mediana(intervalos) : null;
  const limite = med !== null && med > 0 ? med * FACTOR_HUECO : Infinity;

  let huecos = 0;
  base.forEach((p, i) => {
    if (i > 0 && p.t - base[i - 1].t > limite) {
      puntos.push({ t: (p.t + base[i - 1].t) / 2, valor: null });
      huecos++;
    }
    puntos.push({ t: p.t, valor: p.v });
  });

  const primera = base.length ? base[0].t : null;
  const ultima = base.length ? base[base.length - 1].t : null;
  const desde = [inicioMs, primera].filter((x): x is number => typeof x === "number");
  const hasta = [finMs, ultima].filter((x): x is number => typeof x === "number");
  const desdeMs = desde.length ? Math.min(...desde) : 0;
  // El fin nunca queda antes de la última lectura
  const hastaMs = hasta.length ? Math.max(...hasta) : desdeMs + 1;
  return { puntos, desdeMs, hastaMs: Math.max(hastaMs, desdeMs + 1), huecos };
}
