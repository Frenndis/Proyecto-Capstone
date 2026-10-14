// COPIA de CATALOGO_SONDAS de functions/src/types.ts. El build de la web
// (`next build`, output "export") no resuelve archivos fuera de web/ sin tocar
// su configuración, así que el catálogo se duplica aquí. catalogo.test.ts
// compara esta copia con el original y falla si se desfasan: al cambiar el
// catálogo del backend hay que actualizar este archivo.
// Las claves de variable son string (en el backend son el tipo Variable).


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

export const CATALOGO_SONDAS: Record<ModeloSonda, Partial<Record<string, SpecVariable>>> = {
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

