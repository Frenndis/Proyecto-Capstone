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

export type Sonda = { puerto: 1 | 2 | 3; modelo: ModeloSonda };

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
