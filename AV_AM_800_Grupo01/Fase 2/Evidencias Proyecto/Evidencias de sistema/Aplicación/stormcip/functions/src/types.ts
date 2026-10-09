// ─────────────────────────────────────────────────────────────
// Modelo de datos v2 — StormCIP
//  · temperatura genérica → variables separadas por origen
//  · mediciones en `valores`, cálculos en `derivados`
//  · cada derivado declara método y nivel de confianza
// Rangos físicos: datasheet/manual Dragino WQS.
// ─────────────────────────────────────────────────────────────

export const ESQUEMA_VERSION = 2;

// ── Variables MEDIDAS (vienen de un sensor real) ──────────────
export const VARIABLES = [
  "ph", "conductividad", "turbidez", "orp",
  "oxigenoDisuelto", "cloroResidual", "cod",
  "tempSonda",     // temperatura del líquido en la sonda de pH (DR-PH01)
  "tempEc",        // temperatura del líquido en la sonda de conductividad
  "tempExterna",   // sonda DS18B20 externa del WQS-LB
  "tempProceso",   // temperatura de ida de la línea (PLC / instrumentación industrial)
  "concentracion", // % de químico, si existe transmisor dedicado
  "caudal", "presion", "nivel",
] as const;
export type Variable = (typeof VARIABLES)[number];

// ── Variables DERIVADAS (las calcula el backend) ──────────────
export const DERIVADOS = [
  "conductividad25C",       // conductividad compensada a 25 °C
  "volumenEstimado",        // m³ acumulados en la etapa (estimación)
  "tiempoHastaLimpio",      // s hasta cumplir el criterio de agua limpia
  "pendienteConductividad", // µS/cm por minuto: qué tan rápido cae el enjuague
  "arrastreQuimico",        // conductividad residual del primer enjuague
] as const;
export type Derivado = (typeof DERIVADOS)[number];

// "medido" = cálculo directo sobre datos reales.
// "estimado" = usa un supuesto (p. ej. caudal nominal en vez de medido).
// "saturado" = la sonda llegó al tope de su rango: el valor guardado es ese tope
//   y el real es MAYOR o igual (los derivados son una cota inferior).
// "fuera_de_operacion" = la sonda midió sobre su temperatura máxima de
//   operación: se guarda, pero no entra a derivados, umbrales ni indicadores.
export type Confianza = "medido" | "estimado" | "saturado" | "fuera_de_operacion";

export const ETAPAS = [
  "preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion",
] as const;
export type Etapa = (typeof ETAPAS)[number];

// Etapas donde las sondas WQS trabajan dentro de sus límites físicos
export const ETAPAS_MONITOREADAS: Etapa[] = [
  "preenjuague", "enjuague", "enjuague_final",
];

export const ROLES = ["admin", "operador", "visor"] as const;
export type Rol = (typeof ROLES)[number];

export type Rango = { min?: number; max?: number };
// Umbrales de PROCESO, por etapa. Distinto del rango físico de la sonda.
// La clave interna es string porque también se evalúan derivados (ej. conductividad25C).
export type Umbrales = Partial<Record<Etapa, Partial<Record<string, Rango>>>>;

// ── Catálogo de sondas (spec de hardware, NO va en Firestore) ─
// Cotas físicas de fábrica. Bajo `min` siempre es falla de sensor. Sobre `max`
// depende de `satura`:
//  - true: `max` es el tope del rango de MEDICIÓN y el líquido puede superarlo
//    (conductividad de la soda, temperatura de la etapa alcalina): la sonda
//    topa y se guarda `max` con confianza "saturado".
//  - false: `max` es el límite de la ESCALA y ningún líquido lo supera (pH > 14)
//    o la sonda no topa: un valor por encima es falla de sensor y se descarta.
export type SpecVariable = {
  unidad: string; min: number; max: number; resolucion: number;
  satura: boolean;
  tempMaxOperacion?: number; // límite de la sonda, no del proceso
};
export type ModeloSonda =
  | "DR-PH01" | "DR-ECK1.0" | "DR-ECK10.0" | "DR-EC200"
  | "DR-ORP1" | "DR-DO1" | "DR-DO2"
  | "DR-TS1" | "DR-TS200" | "DR-TS4000"
  | "DR-CL-2ML" | "DR-CL-10ML" | "DR-COD" | "DS18B20";

export const CATALOGO_SONDAS: Record<ModeloSonda, Partial<Record<Variable, SpecVariable>>> = {
  "DR-PH01": {
    // 0–14 es la escala completa del pH: un valor fuera es falla, no saturación
    ph:        { unidad: "pH", min: 0, max: 14, resolucion: 0.01, satura: false, tempMaxOperacion: 60 },
    tempSonda: { unidad: "°C", min: 0, max: 60, resolucion: 0.1, satura: true },
  },
  "DR-ECK1.0": {
    conductividad: { unidad: "µS/cm", min: 0, max: 2000, resolucion: 1, satura: true, tempMaxOperacion: 60 },
    tempEc:        { unidad: "°C", min: -20, max: 60, resolucion: 0.1, satura: true },
  },
  "DR-ECK10.0": {
    conductividad: { unidad: "µS/cm", min: 10, max: 20000, resolucion: 10, satura: true, tempMaxOperacion: 60 },
    tempEc:        { unidad: "°C", min: -20, max: 60, resolucion: 0.1, satura: true },
  },
  "DR-EC200": {
    conductividad: { unidad: "µS/cm", min: 1, max: 200000, resolucion: 1, satura: true, tempMaxOperacion: 80 },
    tempEc:        { unidad: "°C", min: -5, max: 80, resolucion: 0.1, satura: true },
  },
  "DR-ORP1":    { orp: { unidad: "mV", min: -1999, max: 1999, resolucion: 1, satura: true } },
  "DR-DO1": {
    // Sobresaturación: el agua puede superar 20 mg/L de oxígeno disuelto
    oxigenoDisuelto: { unidad: "mg/L", min: 0, max: 20, resolucion: 0.01, satura: true, tempMaxOperacion: 50 },
    tempSonda:       { unidad: "°C", min: 0, max: 50, resolucion: 0.01, satura: true },
  },
  "DR-DO2":     { oxigenoDisuelto: { unidad: "mg/L", min: 0, max: 20, resolucion: 0.01, satura: true } },
  // Rango del manual, sección 4.5.2 ("TS01: 0~1000NTU"); resolución 0.1 porque
  // el decoder (wqsDecoder) divide el valor crudo por 10.
  "DR-TS1":     { turbidez: { unidad: "NTU", min: 0, max: 1000, resolucion: 0.1, satura: true, tempMaxOperacion: 40 } },
  "DR-TS200":   { turbidez: { unidad: "NTU", min: 0, max: 200, resolucion: 0.1, satura: true, tempMaxOperacion: 40 } },
  "DR-TS4000":  { turbidez: { unidad: "NTU", min: 0, max: 4000, resolucion: 1, satura: true, tempMaxOperacion: 40 } },
  // La desinfección con hipoclorito puede superar el rango de cloro
  "DR-CL-2ML":  { cloroResidual: { unidad: "mg/L", min: 0, max: 2, resolucion: 0.01, satura: true } },
  "DR-CL-10ML": { cloroResidual: { unidad: "mg/L", min: 0, max: 10, resolucion: 0.01, satura: true } },
  "DR-COD": {
    cod:      { unidad: "mg/L", min: 0, max: 500, resolucion: 0.1, satura: true, tempMaxOperacion: 40 },
    turbidez: { unidad: "NTU", min: 0, max: 200, resolucion: 0.1, satura: true, tempMaxOperacion: 40 },
  },
  // No es una sonda RS485 sino el DS18B20 integrado del WQS-LB (entrada de
  // temperatura externa opcional). Rango de fábrica del chip: el chip no topa
  // en 125 °C (y un CIP no llega ahí), así que un valor fuera es falla.
  "DS18B20":    { tempExterna: { unidad: "°C", min: -55, max: 125, resolucion: 0.1, satura: false } },
};

// Modelos que el decoder propio sabe interpretar hoy (flag de 1 byte, fw < 1.3.1)
export const MODELOS_DECODIFICABLES: ModeloSonda[] = [
  "DR-PH01", "DR-ECK1.0", "DR-ECK10.0", "DR-ORP1", "DR-DO1", "DR-TS1", "DS18B20",
];

// ── Documentos de Firestore ───────────────────────────────────
// Sin "puerto": el protocolo LoRaWAN del WQS-LB identifica sondas por tipo fijo
// (ver wqsDecoder.ts), no por puerto físico libre.
export type Sonda = {
  sondaId: string; modelo: ModeloSonda; activa: boolean;
  ultimaCalibracion?: any; notas?: string;
};

export type Dispositivo = {
  plantaId: string; lineaId: string; tipo: string; activo: boolean;
  apiKeyHash: string;
  devEui?: string;      // identificador LoRaWAN real; NO se asume igual al docId
  firmware?: string;    // obligatorio para equipos LoRaWAN (ver decoder)
  sondas?: Record<string, Sonda>;  // mapa, no array: permite estado por sonda
  ultimoPing?: any;
};

export type Lectura = {
  v: number;                                  // versión de esquema
  ts: any; etapa: Etapa; deviceId: string;
  // null = sensor no conectado (centinela del DS18B20), no dato inválido
  valores: Partial<Record<Variable, number | null>>;
  derivados?: Partial<Record<Derivado, number>>;
  metodo?: Partial<Record<Derivado, string>>;
  // Por variable medida y por derivado (antes solo derivados)
  confianza?: Partial<Record<Variable | Derivado, Confianza>>;
};

/** Último dato de un dispositivo en el ciclo (ciclos/{id}.ultimaLectura.{deviceId}). */
export type UltimaLectura = {
  ts: any;
  valores: Partial<Record<Variable, number | null>>;
  derivados: Partial<Record<Derivado, number>>;
  confianza: Partial<Record<Variable | Derivado, Confianza>>;
  /** Variable → motivo: lo que llegó en esta lectura pero no se guardó. */
  descartadas: Record<string, string>;
};

export type Ciclo = {
  plantaId: string; lineaId: string; camion: string; programa: string;
  estado: "en_curso" | "finalizado" | "abortado";
  etapaActual: Etapa; inicio: any; fin?: any;
  ultimaLectura?: Record<string, UltimaLectura>; // por deviceId
  /**
   * Variables (medidas y derivadas) que cada dispositivo reportó alguna vez en
   * el ciclo. Solo crece: el dashboard arma sus tarjetas con esto para que una
   * variable descartada en una lectura no desaparezca de la pantalla.
   */
  variablesVistas?: Record<string, string[]>; // por deviceId
  // Indicadores agregados: los escribe alCerrarCiclo (ciclos.ts) al finalizar.
  indicadores?: Partial<Record<Derivado, number>>;
  indicadoresMetodo?: Partial<Record<Derivado, string>>;
  indicadoresConfianza?: Partial<Record<Derivado, Confianza>>;
  indicadoresPorEtapa?: Partial<Record<Etapa, {
    derivados: Partial<Record<Derivado, number>>;
    metodo: Partial<Record<Derivado, string>>;
    confianza: Partial<Record<Derivado, Confianza>>;
  }>>;
  lecturasConsideradas?: number;
  indicadoresCalculadosEn?: any;
  /** Bandera de mantenimiento: dispara el recálculo y la borra el trigger. */
  recalcular?: boolean;
  consumos?: Consumos;
};

/**
 * Consumos acumulados del ciclo (ciclos/{id}.consumos). Unidades:
 *  - aguaTotal:      m³ de agua de red.
 *  - aguaRecuperada: m³ de agua recuperada reutilizada (preenjuague).
 *  - soda, acido:    litros de solución de trabajo consumidos (baja neta del estanque).
 */
export type Consumos = { aguaTotal?: number; aguaRecuperada?: number; soda?: number; acido?: number };

// ── Estado de planta en vivo (Firestore: estadoProceso/{lineaId}) ──
// Lo que en la planta real vendría del PLC. Un documento por línea que se
// sobrescribe completo en cada tick, sin historial. Solo lo escribe el backend
// (hoy, scripts/simulador-cip.js con Admin SDK).
export const ESTADO_PROCESO_VERSION = 1;

export type OrigenCircuito = "soda" | "acido" | "agua_red" | "agua_recuperada";
export type DestinoRetorno = "recirculacion" | "drenaje" | "recuperacion";

/** Parte física del estado: la calcula el modelo (simulacion/modeloCip.ts). */
export type EstadoFisico = {
  etapa: Etapa;
  etapaDuracionS: number;
  progresoEtapa: number;     // 0–1
  cicloDuracionS: number;
  transcurridoS: number;
  instrumentos: {
    tempIda: number;         // °C, temperatura de ida
    concentracion: number;   // % de químico en la ida (0 en enjuagues)
    caudal: number;          // m³/h
    presion: number;         // bar
  };
  estanques: {
    soda:  { nivel: number; temp: number; concentracion: number };  // nivel %, °C, %
    acido: { nivel: number; temp: number; concentracion: number };
    aguaRecuperada: { nivel: number };                              // nivel %
  };
  circuito: {
    origen: OrigenCircuito;
    destinoRetorno: DestinoRetorno;
    bomba: { encendida: boolean; rpm: number };
  };
};

export type EstadoProceso = EstadoFisico & {
  v: number; lineaId: string; cicloId: string;
  simulado: boolean; fuente: string;
  actualizadoEn: any;        // serverTimestamp: el cliente detecta "detenido" con él
  /** Permite distinguir un cierre normal o un abort de un simulador que se colgó. */
  estadoCiclo: "en_curso" | "finalizado" | "abortado";
  etapaInicio: any;          // Timestamp
};

// Parámetros de cálculo (Firestore: configuracion/calculos)
export type ParamsCalculo = {
  factorCompensacionEC: number;   // 0.02 = 2 % por °C
  conductividadAguaRed: number;   // µS/cm de referencia del agua limpia
  caudalNominalM3h: number;       // supuesto para estimar volumen sin caudalímetro
  criterioLimpio: { conductividad25C: number; turbidez: number };
};

export const PARAMS_DEFECTO: ParamsCalculo = {
  factorCompensacionEC: 0.02,
  conductividadAguaRed: 150,
  caudalNominalM3h: 18,
  // Igual que seed.js / seed-prod.js: criterio de limpieza, no umbral de alerta
  criterioLimpio: { conductividad25C: 200, turbidez: 10 },
};

export function fueraDeRango(valor: number, r?: Rango) {
  if (!r) return false;
  return (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
}

// Devuelve la spec física de una variable según las sondas ACTIVAS del equipo
export function specDe(variable: Variable, sondas?: Record<string, Sonda>) {
  return sondaDe(variable, sondas)?.spec;
}

// Temperaturas del líquido que mide el propio WQS (no la de proceso del PLC)
export const TEMPERATURAS_LIQUIDO: Variable[] = ["tempEc", "tempSonda", "tempExterna"];

/**
 * Spec física de una variable y la temperatura de la MISMA sonda (la que
 * decide si opera dentro de su tempMaxOperacion): pH → tempSonda,
 * conductividad → tempEc. Una sonda sin temperatura propia (DR-TS1) queda con
 * `temperatura` undefined.
 */
export function sondaDe(variable: Variable, sondas?: Record<string, Sonda>) {
  if (!sondas) return undefined;
  for (const s of Object.values(sondas)) {
    if (!s.activa) continue;
    const vars = CATALOGO_SONDAS[s.modelo] ?? {};
    const spec = vars[variable];
    if (!spec) continue;
    const temperatura = (Object.keys(vars) as Variable[])
      .find((v) => v !== variable && TEMPERATURAS_LIQUIDO.includes(v));
    return { modelo: s.modelo, spec, temperatura };
  }
  return undefined;
}
