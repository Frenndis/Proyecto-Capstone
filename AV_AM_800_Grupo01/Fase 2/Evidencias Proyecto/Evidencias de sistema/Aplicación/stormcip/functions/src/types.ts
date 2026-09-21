export const VARIABLES = [
  "temperatura", "concentracion", "caudal", "presion",
  "ph", "turbidez", "conductividad", "nivel",
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
