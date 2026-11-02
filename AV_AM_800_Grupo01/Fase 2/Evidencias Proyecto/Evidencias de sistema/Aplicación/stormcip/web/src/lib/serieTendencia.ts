// Serie de la tendencia: puntos (tiempo real en ms, valor) de UN ciclo, con un
// corte en la línea donde hay un hueco grande entre lecturas, y las franjas de
// fondo por etapa. Sin React ni Firestore, para poder testearla.
import { Confianza, Lectura, valorDe } from "./tipos";

export type PuntoSerie = {
  t: number;
  /** null: corte de línea (hueco entre lecturas), no una medición. */
  valor: number | null;
  /** Confianza de esta variable en esa lectura (saturado y fuera_de_operacion se dibujan distinto). */
  confianza?: Confianza;
};

export type Serie = {
  puntos: PuntoSerie[];
  /** Límites del eje X: del inicio del ciclo (o la primera lectura si es anterior) al fin/ahora. */
  desdeMs: number;
  hastaMs: number;
  /** Cuántos cortes se insertaron. */
  huecos: number;
};

/** Lo que se necesita de una lectura (Lectura de la web cumple con esto). */
export type LecturaSerie = Pick<Lectura, "ts" | "valores" | "derivados"> & {
  etapa?: string;
  confianza?: Record<string, Confianza>;
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
 *  - `soloEtapas`: si se pasa, solo las lecturas de esas etapas (p. ej. las
 *    monitoreadas); una lectura sin etapa no entra.
 *  - Ordenados por tiempo; el eje X es el tiempo real, no el índice de lectura.
 *  - Entre dos lecturas con un intervalo > FACTOR_HUECO × mediana se inserta un
 *    punto sin valor: la línea se corta en vez de unir con un tramo recto que
 *    parecería una medición. Al filtrar por etapa, las etapas omitidas dejan
 *    exactamente ese tipo de hueco.
 *  - Eje X desde `inicioMs` hasta `finMs`; si falta alguno se usa la primera /
 *    última lectura. Una lectura anterior al inicio extiende el eje, no se pierde.
 */
export function construirSerie(
  lecturas: LecturaSerie[], variable: string,
  { inicioMs, finMs, soloEtapas }: {
    inicioMs?: number | null; finMs?: number | null; soloEtapas?: readonly string[];
  } = {},
): Serie {
  const base = lecturas
    .filter((l) => !soloEtapas || (l.etapa !== undefined && soloEtapas.includes(l.etapa)))
    .map((l) => ({ t: aMs(l.ts), v: valorDe(l, variable), c: l.confianza?.[variable] }))
    .filter((x): x is { t: number; v: number; c: Confianza | undefined } =>
      x.t !== null && typeof x.v === "number")
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
    puntos.push({ t: p.t, valor: p.v, ...(p.c ? { confianza: p.c } : {}) });
  });

  const { desdeMs, hastaMs } = limitesEje(base.map((p) => p.t), inicioMs, finMs);
  return { puntos, desdeMs, hastaMs, huecos };
}

function limitesEje(tiempos: number[], inicioMs?: number | null, finMs?: number | null) {
  const primera = tiempos.length ? Math.min(...tiempos) : null;
  const ultima = tiempos.length ? Math.max(...tiempos) : null;
  const desde = [inicioMs, primera].filter((x): x is number => typeof x === "number");
  const hasta = [finMs, ultima].filter((x): x is number => typeof x === "number");
  const desdeMs = desde.length ? Math.min(...desde) : 0;
  // El fin nunca queda antes de la última lectura
  const hastaMs = hasta.length ? Math.max(...hasta) : desdeMs + 1;
  return { desdeMs, hastaMs: Math.max(hastaMs, desdeMs + 1) };
}

export type Franja = { etapa: string; desdeMs: number; hastaMs: number };

/**
 * Franjas de fondo por etapa, deducidas de la `etapa` que guarda cada lectura
 * (usa TODAS las lecturas, también las que el filtro no dibuja).
 *
 * Es una aproximación: el ciclo aún no registra cuándo cambió cada etapa, así que
 * el límite entre dos franjas es el punto medio entre la última lectura de una
 * etapa y la primera de la siguiente. La primera franja arranca en el inicio del
 * ciclo y la última llega al fin (o a "ahora"); si `etapaActual` ya es otra
 * distinta de la de la última lectura, la última franja no se estira hasta ahora
 * porque no se sabe desde cuándo rige la nueva. Una etapa sin lecturas no tiene franja.
 */
export function franjasPorEtapa(
  lecturas: LecturaSerie[],
  { inicioMs, finMs, etapaActual }: {
    inicioMs?: number | null; finMs?: number | null; etapaActual?: string;
  } = {},
): Franja[] {
  const orden = lecturas
    .map((l) => ({ t: aMs(l.ts), etapa: l.etapa }))
    .filter((x): x is { t: number; etapa: string } => x.t !== null && typeof x.etapa === "string")
    .sort((a, b) => a.t - b.t);
  if (!orden.length) return [];

  // Rachas de lecturas consecutivas con la misma etapa
  const rachas: { etapa: string; primera: number; ultima: number }[] = [];
  for (const { t, etapa } of orden) {
    const r = rachas[rachas.length - 1];
    if (r && r.etapa === etapa) r.ultima = t;
    else rachas.push({ etapa, primera: t, ultima: t });
  }

  const { desdeMs, hastaMs } = limitesEje(orden.map((o) => o.t), inicioMs, finMs);
  const med = mediana(orden.slice(1).map((o, i) => o.t - orden[i].t));

  return rachas.map((r, i) => {
    const anterior = rachas[i - 1];
    const siguiente = rachas[i + 1];
    const desde = anterior ? (anterior.ultima + r.primera) / 2 : desdeMs;
    let hasta: number;
    if (siguiente) hasta = (r.ultima + siguiente.primera) / 2;
    else if (etapaActual !== undefined && etapaActual !== r.etapa) {
      hasta = Math.min(hastaMs, r.ultima + (med ?? 0) / 2);
    } else hasta = hastaMs;
    return { etapa: r.etapa, desdeMs: desde, hastaMs: hasta };
  });
}
