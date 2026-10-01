export type Rol = "admin" | "operador" | "visor";

export type Rango = { min?: number; max?: number };
export type Umbrales = Record<string, Record<string, Rango>>; // etapa -> variable -> rango

export type Lectura = {
  id: string; ts: any; etapa: string; deviceId: string;
  [variable: string]: any;
};

export type Ciclo = {
  id: string; plantaId: string; lineaId: string; camion: string;
  programa: string; estado: string; etapaActual: string; inicio: any;
  consumos?: { aguaTotal: number; aguaRecuperada: number; soda: number; acido: number };
  ultimaLectura?: Record<string, any>;
};

export type Alerta = {
  id: string; cicloId: string; etapa: string; variable: string;
  valor: number; min: number | null; max: number | null;
  severidad: string; ts: any; reconocida: boolean;
};

// Nombre y unidad de cada variable, para mostrar en pantalla
export const META: Record<string, { label: string; unidad: string }> = {
  temperatura:   { label: "Temperatura",  unidad: "°C" },
  concentracion: { label: "Concentración", unidad: "%" },
  caudal:        { label: "Caudal",       unidad: "m³/h" },
  presion:       { label: "Presión",      unidad: "bar" },
  ph:            { label: "pH",           unidad: "" },
  turbidez:      { label: "Turbidez",     unidad: "NTU" },
  conductividad: { label: "Conductividad", unidad: "mS/cm" },
  nivel:         { label: "Nivel",        unidad: "%" },
};

export const ETAPA_LABEL: Record<string, string> = {
  preenjuague: "Preenjuague", alcalino: "Lavado alcalino", enjuague: "Enjuague",
  acido: "Lavado ácido", enjuague_final: "Enjuague final", desinfeccion: "Desinfección",
};

export function fueraDeRango(valor: number, r?: Rango) {
  if (!r) return false;
  return (r.min !== undefined && valor < r.min) || (r.max !== undefined && valor > r.max);
}
