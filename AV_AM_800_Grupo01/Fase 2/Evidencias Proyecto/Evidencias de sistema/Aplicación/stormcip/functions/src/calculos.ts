// Cálculos derivados. Funciones puras: fáciles de testear y de defender,
// porque cada una declara su fórmula y si el resultado es medido o estimado.
import {
  Confianza, Derivado, ParamsCalculo, Variable,
} from "./types";

export type Derivacion = {
  derivados: Partial<Record<Derivado, number>>;
  metodo: Partial<Record<Derivado, string>>;
  confianza: Partial<Record<Derivado, Confianza>>;
};

/**
 * Compensación de temperatura de la conductividad a 25 °C.
 * EC25 = EC / (1 + a · (T - 25)),  a ≈ 0,02 (2 % por °C en soluciones acuosas).
 * Sin esto, dos lecturas a distinta temperatura NO son comparables.
 */
export function compensarConductividad(ec: number, temp: number, a: number) {
  const factor = 1 + a * (temp - 25);
  return factor <= 0 ? ec : ec / factor;
}

/** Derivados que se calculan en cada lectura (baratos, por dato). */
export function derivarLectura(
  valores: Partial<Record<Variable, number>>, p: ParamsCalculo
): Derivacion {
  const d: Derivacion = { derivados: {}, metodo: {}, confianza: {} };
  const ec = valores.conductividad;
  // temperatura del líquido: se prefiere la de la propia sonda EC
  const t = valores.tempEc ?? valores.tempSonda ?? valores.tempExterna;

  if (typeof ec === "number" && typeof t === "number") {
    d.derivados.conductividad25C = +compensarConductividad(ec, t, p.factorCompensacionEC).toFixed(1);
    d.metodo.conductividad25C = `EC / (1 + ${p.factorCompensacionEC}·(T-25)), T=${t} °C`;
    d.confianza.conductividad25C = "medido";
  }
  return d;
}

type LecturaCalculo = { ts: Date; valores: Record<string, number>;
  derivados?: Record<string, number> };

/**
 * Indicadores del ciclo completo. Se calculan al cerrar el ciclo,
 * porque necesitan la curva entera.
 */
export function derivarCiclo(
  lecturas: LecturaCalculo[], inicio: Date, fin: Date, p: ParamsCalculo
): Derivacion {
  const d: Derivacion = { derivados: {}, metodo: {}, confianza: {} };
  const orden = [...lecturas].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const ec25 = (l: LecturaCalculo) => l.derivados?.conductividad25C;

  // 1. Tiempo hasta agua limpia: primera lectura que cumple ambos criterios
  const limpia = orden.find((l) => {
    const e = ec25(l), tu = l.valores.turbidez;
    return typeof e === "number" && e <= p.criterioLimpio.conductividad25C &&
      (tu === undefined || tu <= p.criterioLimpio.turbidez);
  });
  if (limpia) {
    d.derivados.tiempoHastaLimpio = Math.round((limpia.ts.getTime() - inicio.getTime()) / 1000);
    d.metodo.tiempoHastaLimpio =
      `primera lectura con EC25 ≤ ${p.criterioLimpio.conductividad25C} µS/cm y turbidez ≤ ${p.criterioLimpio.turbidez} NTU`;
    d.confianza.tiempoHastaLimpio = "medido";
  }

  // 2. Arrastre de químico: conductividad al inicio del enjuague
  const primera = orden.find((l) => typeof ec25(l) === "number");
  if (primera) {
    d.derivados.arrastreQuimico = +(ec25(primera)! - p.conductividadAguaRed).toFixed(1);
    d.metodo.arrastreQuimico = `EC25 inicial − agua de red (${p.conductividadAguaRed} µS/cm)`;
    d.confianza.arrastreQuimico = "medido";
  }

  // 3. Pendiente de decaimiento: µS/cm por minuto entre primera y última lectura
  const ultima = [...orden].reverse().find((l) => typeof ec25(l) === "number");
  if (primera && ultima && ultima !== primera) {
    const min = (ultima.ts.getTime() - primera.ts.getTime()) / 60000;
    if (min > 0) {
      d.derivados.pendienteConductividad = +((ec25(ultima)! - ec25(primera)!) / min).toFixed(2);
      d.metodo.pendienteConductividad = "ΔEC25 / Δt entre primera y última lectura";
      d.confianza.pendienteConductividad = "medido";
    }
  }

  // 4. Volumen: ESTIMADO. Sin caudalímetro se usa el caudal nominal de la bomba.
  const horas = (fin.getTime() - inicio.getTime()) / 3600000;
  if (horas > 0) {
    d.derivados.volumenEstimado = +(horas * p.caudalNominalM3h).toFixed(3);
    d.metodo.volumenEstimado = `duración (${(horas * 60).toFixed(1)} min) × caudal nominal ${p.caudalNominalM3h} m³/h`;
    d.confianza.volumenEstimado = "estimado"; // supuesto, no medición
  }
  return d;
}
