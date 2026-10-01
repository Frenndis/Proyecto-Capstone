export type Rol = "admin" | "operador" | "visor";

export type Rango = { min?: number; max?: number };
export type Umbrales = Record<string, Record<string, Rango>>; // etapa -> variable -> rango

// Modelo v2: las mediciones viven en `valores`, los cálculos en `derivados`.
// `metodo` guarda la fórmula usada y `confianza` si el dato es medido o estimado.
export type Confianza = "medido" | "estimado";

export type Lectura = {
  id: string; v?: number; ts: any; etapa: string; deviceId: string;
  valores: Record<string, number | null>;
  derivados?: Record<string, number>;
  metodo?: Record<string, string>;
  confianza?: Record<string, Confianza>;
};

export type UltimaLecturaDispositivo = {
  ts: any; valores: Record<string, number | null>; derivados?: Record<string, number>;
};

// Timestamp de Firestore, declarado por la forma en que se usa (toDate) en vez de
// importar el tipo del SDK: así los módulos que solo formatean fechas no dependen
// de firebase/firestore.
export type MarcaTiempo = { toDate: () => Date };

// Los campos `indicadores*` los escribe el trigger alCerrarCiclo (ciclos.ts) al
// finalizar el ciclo. Todos van juntos o no va ninguno.
export type IndicadoresEtapa = {
  derivados: Record<string, number>;
  metodo: Record<string, string>;
  confianza: Record<string, Confianza>;
};

export type Ciclo = {
  id: string; plantaId: string; lineaId: string; camion: string;
  programa: string; estado: string; etapaActual: string; inicio: any; fin?: any;
  consumos?: { aguaTotal: number; aguaRecuperada: number; soda: number; acido: number };
  indicadores?: Record<string, number>;                     // derivados del ciclo cerrado
  indicadoresMetodo?: Record<string, string>;               // fórmula usada en cada uno
  indicadoresConfianza?: Record<string, Confianza>;          // medido | estimado
  indicadoresPorEtapa?: Record<string, IndicadoresEtapa>;   // desglose por etapa
  lecturasConsideradas?: number;                            // cuántas entraron al cálculo
  // null: un serverTimestamp recién escrito llega vacío al listener local antes
  // de confirmarse en el servidor.
  indicadoresCalculadosEn?: MarcaTiempo | null;             // marca de que el trigger corrió
  ultimaLectura?: Record<string, UltimaLecturaDispositivo>; // anidada por deviceId
};

// Una alerta por ciclo+etapa+variable: se actualiza mientras la condición dura
export type Alerta = {
  id: string; cicloId: string; lineaId?: string | null; etapa: string; variable: string;
  ultimoValor: number; min: number | null; max: number | null;
  severidad: string; desde: any; hasta: any; conteo?: number; reconocida: boolean;
};

export const META: Record<string, { label: string; unidad: string; decimales?: number }> = {
  // Medidas
  ph:            { label: "pH",             unidad: "",      decimales: 2 },
  conductividad: { label: "Conductividad",  unidad: "µS/cm", decimales: 0 },
  turbidez:      { label: "Turbidez",       unidad: "NTU",   decimales: 1 },
  tempEc:        { label: "Temp. sonda EC", unidad: "°C",    decimales: 1 },
  tempSonda:     { label: "Temp. sonda pH", unidad: "°C",    decimales: 1 },
  tempExterna:   { label: "Temp. externa",  unidad: "°C",    decimales: 1 },
  tempProceso:   { label: "Temp. proceso",  unidad: "°C",    decimales: 1 },
  orp:           { label: "ORP",            unidad: "mV",    decimales: 0 },
  concentracion: { label: "Concentración",  unidad: "%",     decimales: 2 },
  caudal:        { label: "Caudal",         unidad: "m³/h",  decimales: 1 },
  presion:       { label: "Presión",        unidad: "bar",   decimales: 2 },
  nivel:         { label: "Nivel",          unidad: "%",     decimales: 0 },
  // Derivadas (las calcula el backend, ver calculos.ts)
  conductividad25C:       { label: "Conductividad a 25 °C", unidad: "µS/cm",     decimales: 0 },
  tiempoHastaLimpio:      { label: "Tiempo hasta limpio",   unidad: "s",         decimales: 0 },
  arrastreQuimico:        { label: "Arrastre químico",      unidad: "µS/cm",     decimales: 0 },
  // "µS/cm·min" se lee como producto; el indicador es una tasa POR minuto.
  pendienteConductividad: { label: "Caída de EC",           unidad: "µS/cm/min", decimales: 1 },
  volumenEstimado:        { label: "Volumen estimado",      unidad: "m³",        decimales: 2 },
};

export const DERIVADOS = [
  "conductividad25C", "tiempoHastaLimpio", "arrastreQuimico",
  "pendienteConductividad", "volumenEstimado",
];
export const esDerivado = (v: string) => DERIVADOS.includes(v);

export const ETAPA_LABEL: Record<string, string> = {
  preenjuague: "Preenjuague", alcalino: "Lavado alcalino", enjuague: "Enjuague",
  acido: "Lavado ácido", enjuague_final: "Enjuague final", desinfeccion: "Desinfección",
};

// Etapas donde las sondas WQS operan dentro de su rango físico (ver modelo v2)
export const ETAPAS_MONITOREADAS = ["preenjuague", "enjuague", "enjuague_final"];

export function fueraDeRango(valor: number, r?: Rango) {
  if (!r) return false;
  return (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
}

export function formatear(variable: string, valor?: number | null) {
  if (valor === undefined || valor === null) return "—";
  const d = META[variable]?.decimales ?? 2;
  return valor.toFixed(d);
}

// Indicadores del ciclo, en el orden en que se muestran. conductividad25C queda
// fuera: es un derivado POR LECTURA, no un agregado del ciclo.
export const INDICADORES_CICLO = [
  "tiempoHastaLimpio", "arrastreQuimico", "pendienteConductividad", "volumenEstimado",
];

/**
 * Por qué cuatro estados y no "hay datos / no hay datos": un espacio vacío no
 * distingue "el ciclo sigue abierto" de "cerró sin datos usables", y son dos
 * cosas distintas para quien mira el dashboard.
 *
 *  · pendiente    — el trigger no ha corrido (ciclo en curso)
 *  · sin_lecturas — corrió, pero ninguna lectura cayó en etapa monitoreada
 *  · sin_valores  — hubo lecturas, pero ninguna con conductividad válida
 *  · listo        — hay indicadores que mostrar
 */
export type EstadoIndicadores =
  | { tipo: "pendiente" }
  | { tipo: "sin_lecturas" }
  | { tipo: "sin_valores"; lecturas: number }
  | { tipo: "listo"; claves: string[]; lecturas: number };

export function estadoIndicadores(ciclo?: {
  indicadores?: Record<string, number>;
  lecturasConsideradas?: number;
  indicadoresCalculadosEn?: MarcaTiempo | null;
}): EstadoIndicadores {
  // La marca de tiempo es la señal de que el trigger corrió; `indicadores` puede
  // quedar en {} legítimamente, así que no sirve para distinguir.
  if (!ciclo?.indicadoresCalculadosEn) return { tipo: "pendiente" };

  const lecturas = ciclo.lecturasConsideradas ?? 0;
  if (lecturas === 0) return { tipo: "sin_lecturas" };

  const claves = INDICADORES_CICLO.filter(
    (k) => typeof ciclo.indicadores?.[k] === "number"
  );
  return claves.length === 0
    ? { tipo: "sin_valores", lecturas }
    : { tipo: "listo", claves, lecturas };
}

/** Toma el valor de una lectura, venga de `valores` (medido) o de `derivados` (calculado). */
export function valorDe(l: Pick<Lectura, "valores" | "derivados">, variable: string) {
  const medido = l.valores?.[variable];
  if (typeof medido === "number") return medido;
  const calculado = l.derivados?.[variable];
  return typeof calculado === "number" ? calculado : undefined;
}
