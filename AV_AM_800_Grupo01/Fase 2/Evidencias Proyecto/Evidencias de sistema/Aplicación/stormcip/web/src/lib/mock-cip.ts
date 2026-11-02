// Datos simulados del mockup de monitoreo CIP (pantalla /monitoreo).
// No provienen de Firestore: esta pantalla es una maqueta de operación y se
// mantiene aislada del modelo de datos real para no confundir ambas fuentes.

export type EstadoKpi = "EN RANGO" | "RECIRCULABLE" | "ATENCION" | "FUERA DE RANGO";

export type SensorKpi = {
  key: string;
  label: string;
  code: string;
  value: number;
  unit: string;
  target: string;
  status: EstadoKpi;
  decimals: number;
  /** Amplitud de la oscilación simulada: el valor nunca salta bruscamente. */
  jitter: number;
  /** Límites operativos; fuera de ellos la tarjeta cambia de color. */
  min?: number;
  max?: number;
};

export const mockCycle = {
  id: "CIP-2026-0847",
  truck: "LSGB-73",
  dock: "Andén 2",
  line: "CIP-01",
  program: "Estanque leche · estándar",
  startTime: "09:12",
  elapsedSeconds: 24 * 60 + 35,
  remainingMinutes: 48,
  stage: 2,
  stageName: "Lavado alcalino",
  stageDetail: "soda 1–2% · 75–80 °C",
  stageProgress: 70,
};

export const stages = [
  "PREENJ.", "ALCALINO", "ENJ.", "ÁCIDO", "ENJ. FINAL", "DESINF.",
];

export const sensors: SensorKpi[] = [
  { key: "temp", label: "Temperatura ida", code: "TT-01", value: 76.2, unit: "°C",
    target: "obj 75–80", status: "EN RANGO", decimals: 1, jitter: 0.15, min: 75, max: 80 },
  { key: "conc", label: "Concentración", code: "CT-01", value: 1.8, unit: "%",
    target: "obj 1.0–2.0", status: "EN RANGO", decimals: 2, jitter: 0.02, min: 1, max: 2 },
  { key: "flow", label: "Caudal", code: "FT-01", value: 18.4, unit: "m³/h",
    target: "obj ≥ 16", status: "EN RANGO", decimals: 1, jitter: 0.2, min: 16 },
  { key: "press", label: "Presión", code: "PT-01", value: 2.4, unit: "bar",
    target: "obj 2.0–3.0", status: "EN RANGO", decimals: 1, jitter: 0.05, min: 2, max: 3 },
  { key: "ph", label: "pH retorno", code: "AT-01", value: 12.1, unit: "",
    target: "esperado > 11.5", status: "EN RANGO", decimals: 1, jitter: 0.05, min: 11.5 },
  { key: "turb", label: "Turbidez retorno", code: "TU-01", value: 13, unit: "NTU",
    target: "límite 40", status: "RECIRCULABLE", decimals: 0, jitter: 0.6, max: 40 },
];

export const tanks = [
  {
    key: "caustic", name: "Soda cáustica", level: 71, levelTag: "NIVEL · LT-01",
    lines: ["76.2 °C", "1.8% NaOH"], status: "EN SERVICIO", tone: "yellow" as const,
  },
  {
    key: "acid", name: "Ácido", level: 88, levelTag: "NIVEL · LT-02",
    lines: ["60.1 °C", "0.8% HNO3"], status: "EN ESPERA", tone: "magenta" as const,
  },
  {
    key: "water", name: "Agua recuperada", level: 45, levelTag: "NIVEL · LT-03",
    lines: ["Ambiente", "+ PRE-ENJUAGUE"], status: "EN ESPERA", tone: "cyan" as const,
  },
];

export const returnQuality = {
  turbidity: 13,
  conductivity: 77.6,
  drainLimit: 40,
  /** 12 min de histórico simulado, una muestra por minuto. */
  history: [16, 15.4, 15.8, 14.9, 14.2, 14.6, 13.9, 13.4, 13.6, 13.1, 12.8, 13],
};

export const consumption = [
  { label: "Agua total", value: "2.4", unit: "m³", tone: "cyan" },
  { label: "Agua recuperada usada", value: "1.5", unit: "m³", tone: "green" },
  { label: "Soda dosificada", value: "34", unit: "L", tone: "yellow" },
  { label: "Ácido dosificado", value: "—", unit: "etapa 4", tone: "magenta" },
];

export const cliente = {
  nombre: "Planta de recepción",
  detalle: "Recepción de camiones · CIP-01",
  empresa: "Austral Chemicals Chile S.A.",
};

/** Oscilación suave alrededor del valor base: nunca saltos bruscos. */
export function deriva(base: number, actual: number, jitter: number, decimals: number) {
  const paso = (Math.random() - 0.5) * 2 * jitter;
  // Tira del valor hacia la base para que no derive indefinidamente.
  const siguiente = actual + paso + (base - actual) * 0.25;
  return Number(siguiente.toFixed(decimals));
}

export function formatoReloj(totalSegundos: number) {
  const h = Math.floor(totalSegundos / 3600);
  const m = Math.floor((totalSegundos % 3600) / 60);
  const s = totalSegundos % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Estado que corresponde a un valor, para pintar la tarjeta. */
export function evaluar(s: SensorKpi, valor: number): EstadoKpi {
  const bajo = s.min !== undefined && valor < s.min;
  const alto = s.max !== undefined && valor > s.max;
  if (!bajo && !alto) return s.status;
  // Un 5% de desviación es atención; más que eso, fuera de rango.
  const ref = bajo ? s.min! : s.max!;
  return Math.abs(valor - ref) / Math.max(Math.abs(ref), 1) > 0.05
    ? "FUERA DE RANGO" : "ATENCION";
}
