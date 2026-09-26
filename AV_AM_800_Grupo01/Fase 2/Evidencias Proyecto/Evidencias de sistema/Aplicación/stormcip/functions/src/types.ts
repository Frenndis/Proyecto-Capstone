export const VARIABLES = [
  "temperatura", "concentracion", "caudal", "presion",
  "ph", "turbidez", "conductividad", "nivel",
  "orp", "oxigenoDisuelto", "cloroResidual", "cod",
] as const;
export type Variable = (typeof VARIABLES)[number];

export const ETAPAS = [
  "preenjuague", "alcalino", "enjuague", "acido", "enjuague_final", "desinfeccion",
] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ROLES = ["admin", "operador", "visor"] as const;
export type Rol = (typeof ROLES)[number];

export type Rango = { min?: number; max?: number };
export type Umbrales = Partial<Record<Variable, Rango>>;

// Sondas Dragino WQS conectadas por RS485 a una unidad WQS-LB (1 a 3 por unidad)
export const MODELOS_SONDA = [
  "DR-ECK1.0", "DR-ECK10.0", "DR-EC200", "DR-PH01", "DR-ORP1",
  "DR-DO1", "DR-DO2", "DR-TS200", "DR-TS4000", "DR-CL-2ML", "DR-CL-10ML", "DR-COD",
] as const;
export type ModeloSonda = (typeof MODELOS_SONDA)[number];

// Sin "puerto": el protocolo LoRaWAN del WQS-LB identifica sondas por tipo (ver
// BIT_SONDA_LORAWAN), no por puerto físico libre.
export type Sonda = { modelo: ModeloSonda };

// Modelos que el firmware/decoder oficial del WQS-LB realmente reporta por LoRaWAN.
// DR-EC200, DR-CL-2ML, DR-CL-10ML y DR-COD NO están en el decoder revisado
// (github.com/dragino/dragino-end-node-decoder, WQS-LB_TTN_Decoder.txt) — podrían
// requerir otra variante de firmware, a confirmar antes de usarlos en campo.
export const SOPORTADO_LORAWAN_WQSLB: ModeloSonda[] = [
  "DR-PH01", "DR-ECK1.0", "DR-ECK10.0", "DR-ORP1", "DR-DO1", "DR-DO2", "DR-TS200", "DR-TS4000",
];

// Byte de flags (bits 0-5 de bytes[4], FPort=2) del decoder oficial Dragino: indica
// qué sondas están presentes en cada uplink y con qué nombre aparece el campo ya
// decodificado por TTN en `uplink_message.decoded_payload`.
export const BIT_SONDA_LORAWAN: { bit: number; campoDecoder: string; variable: Variable }[] = [
  { bit: 0, campoDecoder: "PH", variable: "ph" },
  { bit: 1, campoDecoder: "EC_K1", variable: "conductividad" },
  { bit: 2, campoDecoder: "EC_K10", variable: "conductividad" },
  { bit: 3, campoDecoder: "ORP", variable: "orp" },
  { bit: 4, campoDecoder: "dissolved_oxygen", variable: "oxigenoDisuelto" },
  { bit: 5, campoDecoder: "turbidity", variable: "turbidez" },
];

// Rango físico de fábrica por variable (datasheet Dragino) — valida que la lectura sea posible,
// distinto de `Umbrales` que valida que sea aceptable para el proceso CIP.
export type EspecVariable = { unidad: string; min: number; max: number; resolucion: number };

export const CATALOGO_SONDAS: Record<ModeloSonda, Partial<Record<Variable, EspecVariable>>> = {
  "DR-ECK1.0": {
    conductividad: { unidad: "µS/cm", min: 0, max: 2000, resolucion: 1 },
    temperatura: { unidad: "°C", min: -20, max: 60, resolucion: 0.1 },
  },
  "DR-ECK10.0": {
    conductividad: { unidad: "µS/cm", min: 10, max: 20000, resolucion: 10 },
    temperatura: { unidad: "°C", min: -20, max: 60, resolucion: 0.1 },
  },
  "DR-EC200": {
    conductividad: { unidad: "µS/cm", min: 1, max: 200000, resolucion: 1 },
    temperatura: { unidad: "°C", min: -5, max: 80, resolucion: 0.1 },
  },
  "DR-PH01": {
    ph: { unidad: "pH", min: 0, max: 14, resolucion: 0.01 },
    temperatura: { unidad: "°C", min: 0, max: 60, resolucion: 0.1 },
  },
  "DR-ORP1": {
    orp: { unidad: "mV", min: -1999, max: 1999, resolucion: 1 },
  },
  "DR-DO1": {
    oxigenoDisuelto: { unidad: "mg/L", min: 0, max: 20, resolucion: 0.01 },
    temperatura: { unidad: "°C", min: 0, max: 50, resolucion: 0.01 },
  },
  "DR-DO2": {
    oxigenoDisuelto: { unidad: "mg/L", min: 0, max: 20, resolucion: 0.01 },
  },
  "DR-TS200": {
    turbidez: { unidad: "NTU", min: 0, max: 200, resolucion: 0.1 },
  },
  "DR-TS4000": {
    turbidez: { unidad: "NTU", min: 0, max: 4000, resolucion: 1 },
  },
  "DR-CL-2ML": {
    cloroResidual: { unidad: "mg/L", min: 0, max: 2, resolucion: 0.01 },
  },
  "DR-CL-10ML": {
    cloroResidual: { unidad: "mg/L", min: 0, max: 10, resolucion: 0.01 },
  },
  "DR-COD": {
    cod: { unidad: "mg/L", min: 0, max: 500, resolucion: 0.1 },
    turbidez: { unidad: "NTU", min: 0, max: 200, resolucion: 0.1 },
  },
};
