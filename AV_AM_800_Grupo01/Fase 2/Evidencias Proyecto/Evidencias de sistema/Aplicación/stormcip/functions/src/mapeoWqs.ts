// Campos del decoder WQS-LB (wqsDecoder.ts) → variables del modelo v2.
// Lo usa ttnUplink (lorawanAdapter.ts) y el test del modelo de simulación, para
// que ambos recorran exactamente el mismo camino.
import { LecturaTiempoReal } from "./wqsDecoder";
import { ModeloSonda, Sonda, Variable } from "./types";

// Las tres temperaturas se guardan SEPARADAS por origen (modelo v2): la sonda
// de pH y la de conductividad miden el mismo líquido pero en puntos distintos.
// `tempEc` es además la que usa calculos.ts para compensar la conductividad.
//
// ORP y oxígeno disuelto no aplican a este proyecto y se ignoran.
const CAMPO_A_VARIABLE: Partial<Record<keyof LecturaTiempoReal, Variable>> = {
  ph: "ph",
  phTemp: "tempSonda",
  turbidez: "turbidez",
  tempExterna: "tempExterna",
};

// El WQS-LB admite dos sondas de conductividad (bit 1 EC_K1, bit 2 EC_K10) que
// terminan en la misma variable. El equipo comprado lleva la DR-ECK1.0
// (0–2000 µS/cm); la DR-ECK10.0 queda soportada por si se cambia la sonda.
const SONDAS_CONDUCTIVIDAD: { modelo: ModeloSonda; ec: keyof LecturaTiempoReal; temp: keyof LecturaTiempoReal }[] = [
  { modelo: "DR-ECK1.0", ec: "ecK1", temp: "ecK1Temp" },
  { modelo: "DR-ECK10.0", ec: "ecK10", temp: "ecK10Temp" },
];

/**
 * Si el payload trae las dos conductividades, se usa la de la sonda que el
 * equipo declara activa (la ECK1.0 si declara ambas). Sin sondas declaradas, la
 * primera presente; procesarLectura la descartará igual por falta de sonda.
 */
export function mapearAValores(
  datos: LecturaTiempoReal, sondas?: Record<string, Sonda>,
): Record<string, unknown> {
  const campos = datos as Record<string, unknown>;
  const valores: Record<string, unknown> = {};
  for (const [campo, variable] of Object.entries(CAMPO_A_VARIABLE)) {
    const valor = campos[campo];
    if (valor === undefined) continue;
    valores[variable] = valor;
  }

  const activos = sondas
    ? new Set(Object.values(sondas).filter((s) => s.activa).map((s) => s.modelo))
    : undefined;
  const presentes = SONDAS_CONDUCTIVIDAD.filter((s) => campos[s.ec] !== undefined);
  const ec = presentes.find((s) => !activos || activos.has(s.modelo)) ?? presentes[0];
  if (ec) {
    valores.conductividad = campos[ec.ec];
    if (campos[ec.temp] !== undefined) valores.tempEc = campos[ec.temp];
  }
  return valores;
}
