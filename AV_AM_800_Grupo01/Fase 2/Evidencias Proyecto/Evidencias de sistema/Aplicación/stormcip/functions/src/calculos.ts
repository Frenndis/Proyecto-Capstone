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

/**
 * Derivados que se calculan en cada lectura (baratos, por dato).
 *
 * `confianza` es la de cada variable medida (ver validarYLimpiarValores):
 *  - Conductividad saturada con temperatura válida: EC25 se calcula, pero es
 *    una COTA INFERIOR (el EC real es ≥ el tope de la sonda) y queda "saturado".
 *  - Conductividad fuera de operación, o temperatura saturada o fuera de
 *    operación: EC25 no se calcula; la compensación con una temperatura
 *    desconocida daría un número sin sentido.
 */
export function derivarLectura(
  valores: Partial<Record<Variable, number>>, p: ParamsCalculo,
  confianza: Partial<Record<Variable, Confianza>> = {},
): Derivacion {
  const d: Derivacion = { derivados: {}, metodo: {}, confianza: {} };
  const ec = valores.conductividad;
  // temperatura del líquido: se prefiere la de la propia sonda EC
  const tVar = (["tempEc", "tempSonda", "tempExterna"] as const)
    .find((k) => typeof valores[k] === "number");
  const t = tVar ? valores[tVar] : undefined;
  const confEc = confianza.conductividad ?? "medido";
  const confT = tVar ? confianza[tVar] ?? "medido" : undefined;
  const tempUtil = confT !== "saturado" && confT !== "fuera_de_operacion";

  if (typeof ec === "number" && typeof t === "number" && confEc !== "fuera_de_operacion" && tempUtil) {
    const saturada = confEc === "saturado";
    d.derivados.conductividad25C = +compensarConductividad(ec, t, p.factorCompensacionEC).toFixed(1);
    d.metodo.conductividad25C = `EC / (1 + ${p.factorCompensacionEC}·(T-25)), T=${t} °C` +
      (saturada ? ` (cota inferior: sonda saturada en ${ec} µS/cm)` : "");
    d.confianza.conductividad25C = saturada ? "saturado" : "medido";
  }
  return d;
}

type LecturaCalculo = { ts: Date; valores: Record<string, number>;
  derivados?: Record<string, number>;
  confianza?: Record<string, Confianza> };

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
  const conf = (l: LecturaCalculo, k: string) => l.confianza?.[k] ?? "medido";
  const ec25Saturada = (l: LecturaCalculo) => conf(l, "conductividad25C") === "saturado";

  // 1. Tiempo hasta agua limpia: primera lectura que cumple todos los criterios.
  // Una EC25 saturada es cota inferior: nunca cuenta como limpia. La turbidez
  // solo se exige si el equipo la mide; fuera de operación no es evaluable.
  const hayTurbidez = orden.some((l) => l.valores.turbidez !== undefined || l.confianza?.turbidez);
  const limpia = orden.find((l) => {
    const e = ec25(l), tu = l.valores.turbidez;
    if (typeof e !== "number" || ec25Saturada(l) || e > p.criterioLimpio.conductividad25C) return false;
    // ciclos.ts ya sacó de `valores` la turbidez fuera de operación: se mira la confianza
    if (conf(l, "turbidez") === "fuera_de_operacion") return false;
    return tu === undefined || tu <= p.criterioLimpio.turbidez;
  });
  if (limpia) {
    d.derivados.tiempoHastaLimpio = Math.round((limpia.ts.getTime() - inicio.getTime()) / 1000);
    d.metodo.tiempoHastaLimpio =
      `primera lectura con EC25 ≤ ${p.criterioLimpio.conductividad25C} µS/cm` +
      (hayTurbidez ? ` y turbidez ≤ ${p.criterioLimpio.turbidez} NTU` : "");
    d.confianza.tiempoHastaLimpio = "medido";
  }

  // 2. Arrastre de químico: conductividad al inicio del enjuague. Si la sonda
  // estaba saturada, es una cota inferior ("al menos").
  const primera = orden.find((l) => typeof ec25(l) === "number");
  if (primera) {
    const saturada = ec25Saturada(primera);
    d.derivados.arrastreQuimico = +(ec25(primera)! - p.conductividadAguaRed).toFixed(1);
    d.metodo.arrastreQuimico = `EC25 inicial − agua de red (${p.conductividadAguaRed} µS/cm)` +
      (saturada ? " (cota inferior: sonda saturada)" : "");
    d.confianza.arrastreQuimico = saturada ? "saturado" : "medido";
  }

  // 3. Pendiente de decaimiento: µS/cm por minuto entre la primera y la última
  // lectura NO saturadas (con un tope de sonda la pendiente real queda oculta).
  const conEc = orden.filter((l) => typeof ec25(l) === "number" && !ec25Saturada(l));
  const desde = conEc[0];
  const hasta = conEc[conEc.length - 1];
  if (desde && hasta && hasta !== desde) {
    const min = (hasta.ts.getTime() - desde.ts.getTime()) / 60000;
    if (min > 0) {
      d.derivados.pendienteConductividad = +((ec25(hasta)! - ec25(desde)!) / min).toFixed(2);
      d.metodo.pendienteConductividad =
        conEc.length < orden.filter((l) => typeof ec25(l) === "number").length
          ? "ΔEC25 / Δt entre la primera y la última lectura no saturadas"
          : "ΔEC25 / Δt entre primera y última lectura";
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
