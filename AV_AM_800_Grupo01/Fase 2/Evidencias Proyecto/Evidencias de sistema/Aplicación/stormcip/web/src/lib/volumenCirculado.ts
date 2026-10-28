// Lógica pura de la sección "Líquido usado": qué filas mostrar y en qué estado
// está. Sin React ni Firestore, para poder testearla.
//
// Qué se cuenta como "usado" en cada etapa:
//  · Enjuagues y desinfección (agua de paso único): el volumen circulado de la
//    etapa, que coincide con el consumo porque el agua entra y va al desagüe.
//    Se integra el caudal, así que queda ~2 % bajo el valor real por los bordes.
//  · Alcalino y ácido: lo que dice ciclos/{id}.consumos (soda, acido), que es la
//    solución retenida en el circuito. Es una constante del modelo, no una
//    medición: va marcado como estimado. El volumen que recirculó se informa
//    aparte, porque sumarlo como consumo contaría varias veces el mismo litro.
// Agua de red y agua recuperada nunca se suman entre sí, ni con los químicos.
import { Ciclo, ETAPAS_MONITOREADAS, ETAPA_LABEL } from "./tipos";

/** Orden del ciclo CIP (mismo que ETAPAS del backend). */
export const ORDEN_ETAPAS = [
  "preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion",
];

/** De dónde sale el líquido que se usa en cada etapa. */
export type Fuente = "red" | "recuperada" | "soda" | "acido";

const FUENTE: Record<string, Fuente> = {
  preenjuague: "recuperada", alcalino: "soda", enjuague: "red",
  acido: "acido", enjuague_final: "red", desinfeccion: "red",
};

/** La desinfección usa agua de red con sanitizante diluido (0,15 % en el modelo). */
export const ETIQUETA_DESINFECCION = "Desinfección (agua con sanitizante 0,15 %)";

export type FilaUso = {
  etapa: string; label: string; fuente: Fuente;
  /** Agua (paso único) o solución química (retenida en el circuito). */
  tipo: "agua" | "quimico";
  /** Litros usados; null: la etapa aún no tiene dato. */
  litros: number | null;
  /** Solo químicos: litros que recirculó la etapa (dato secundario, no es consumo). */
  recirculadoL: number | null;
  /** Estimación del modelo, no una medición (se pinta ámbar, punteado y con ≈). */
  estimado: boolean;
  /** La etapa está corriendo: el valor se completa al terminar. */
  enCurso: boolean;
  /** Enjuagues (azul) frente a etapas químicas (ámbar), como en la tendencia. */
  monitoreada: boolean;
  /** Desinfección: el sanitizante no tiene estanque ni consumo en el modelo. */
  sanitizanteSinDato: boolean;
};

/** Totales por tipo de líquido; null: ninguna fila de ese tipo tiene dato. */
export type TotalesUso = {
  aguaRedL: number | null; aguaRecuperadaL: number | null;
  sodaL: number | null; acidoL: number | null;
};

export type EstadoVolumen =
  /** El equipo no informa caudal: no hay volumen que mostrar (no es "0 L"). */
  | { tipo: "sin_caudal" }
  /** Hay caudal pero el backend todavía no sumó nada. */
  | { tipo: "acumulando" }
  | { tipo: "listo"; filas: FilaUso[]; totales: TotalesUso; simulado: boolean; huecos: number };

type CicloVolumen = Pick<Ciclo, "volumenCirculado" | "consumos" | "estado" | "etapaActual">;

const orden = (etapa: string) => ORDEN_ETAPAS.indexOf(etapa);
const suma = (xs: (number | null)[]) => {
  const con = xs.filter((x): x is number => x !== null);
  return con.length === 0 ? null : con.reduce((s, x) => s + x, 0);
};

/**
 * Estado de la sección. Sin `volumenCirculado` en el ciclo no se muestra 0 L:
 * o el caudal ya llega y se está acumulando (ciclo en curso), o no hay caudal.
 * La desinfección solo aparece si tiene volumen; el resto de las etapas siempre
 * (las que aún no corrieron, sin valor).
 */
export function estadoVolumen(
  ciclo: CicloVolumen | null | undefined, caudalActual: number | undefined, enVivo: boolean,
): EstadoVolumen {
  const vc = ciclo?.volumenCirculado;
  const circulado = vc?.litros ?? {};
  const conDatos = ORDEN_ETAPAS.filter((e) => typeof circulado[e] === "number");
  if (conDatos.length === 0) {
    return enVivo && typeof caudalActual === "number" ? { tipo: "acumulando" } : { tipo: "sin_caudal" };
  }

  const enCursoCiclo = ciclo?.estado === "en_curso";
  const etapaActual = orden(ciclo?.etapaActual ?? "");
  const filas: FilaUso[] = ORDEN_ETAPAS
    .filter((e) => e !== "desinfeccion" || (circulado[e] ?? 0) > 0)
    .map((e): FilaUso => {
      const fuente = FUENTE[e];
      const quimico = fuente === "soda" || fuente === "acido";
      const recirculado = typeof circulado[e] === "number" ? circulado[e] : null;
      const enCurso = enCursoCiclo && e === ciclo?.etapaActual;
      // consumos se escribe al cambiar de etapa: mientras la etapa corre vale 0 y
      // mostrarlo sería un dato falso. Solo se informa con la etapa ya terminada.
      const terminada = !enCursoCiclo || etapaActual > orden(e);
      const consumo = quimico ? ciclo?.consumos?.[fuente] : undefined;
      const litros = quimico
        ? (recirculado !== null && terminada && typeof consumo === "number" ? consumo : null)
        : recirculado;
      return {
        etapa: e, label: e === "desinfeccion" ? ETIQUETA_DESINFECCION : (ETAPA_LABEL[e] ?? e),
        fuente, tipo: quimico ? "quimico" : "agua", litros,
        recirculadoL: quimico ? recirculado : null,
        estimado: quimico, enCurso,
        monitoreada: ETAPAS_MONITOREADAS.includes(e),
        sanitizanteSinDato: e === "desinfeccion",
      };
    });

  const deFuente = (f: Fuente) => suma(filas.filter((x) => x.fuente === f).map((x) => x.litros));
  const totales: TotalesUso = {
    aguaRedL: deFuente("red"), aguaRecuperadaL: deFuente("recuperada"),
    sodaL: deFuente("soda"), acidoL: deFuente("acido"),
  };
  return { tipo: "listo", filas, totales, simulado: vc?.simulado === true, huecos: vc?.huecos ?? 0 };
}

const entero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const m3Tres = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const m3Dos = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.396 L" o "—" si la etapa no tiene valor. */
export const formatearLitros = (l: number | null) => (l === null ? "—" : `${entero.format(l)} L`);

/**
 * Agua en m³: 3 decimales bajo 10 m³ (1 L de resolución), 2 desde ahí. Bajo
 * 1 m³ se agregan los litros entre paréntesis: "0,187 m³ (187 L)".
 */
export function formatearM3(litros: number | null): string {
  if (litros === null) return "—";
  const m3 = litros / 1000;
  const texto = `${(m3 < 10 ? m3Tres : m3Dos).format(m3)} m³`;
  return m3 < 1 ? `${texto} (${entero.format(litros)} L)` : texto;
}

/** Valor de una fila: agua en m³, soluciones químicas en litros sin decimales. */
export const formatearUso = (f: Pick<FilaUso, "tipo" | "litros">) =>
  f.tipo === "agua" ? formatearM3(f.litros) : formatearLitros(f.litros);
