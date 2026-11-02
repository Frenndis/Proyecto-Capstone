// Lógica pura de las tarjetas del dashboard: qué variables mostrar y en qué
// estado está cada una. Sin React ni Firestore, para poder testearla.
import { CATALOGO_SONDAS, SpecVariable } from "./catalogo";
import { DERIVADOS, SondaDispositivo, UltimaLecturaDispositivo } from "./tipos";

// Mismo orden de preferencia que derivarLectura (functions/src/calculos.ts):
// la primera temperatura con número es la que compensa la conductividad.
const TEMPERATURAS_LIQUIDO = ["tempEc", "tempSonda", "tempExterna"];

// Orden de las tarjetas: lo que decide si el agua está limpia va primero.
const ORDEN = ["conductividad25C", "conductividad", "tempEc", "ph", "tempSonda", "tempExterna"];

/** Spec de la primera sonda activa que mide `variable` (misma regla que sondaDe del backend). */
function specDe(variable: string, sondas?: Record<string, SondaDispositivo>): SpecVariable | undefined {
  for (const s of Object.values(sondas ?? {})) {
    if (!s.activa) continue;
    const spec = (CATALOGO_SONDAS as Record<string, Partial<Record<string, SpecVariable>>>)[s.modelo]?.[variable];
    if (spec) return spec;
  }
  return undefined;
}

/** Tope de la sonda (CATALOGO_SONDAS), o undefined si el equipo no la tiene configurada. */
export const topeDe = (variable: string, sondas?: Record<string, SondaDispositivo>) =>
  specDe(variable, sondas)?.max;

/**
 * Variables con tarjeta: las de `variablesVistas` que miden las sondas ACTIVAS
 * del equipo. Una variable vista en una configuración anterior (otra sonda)
 * no se muestra. Sin sondas registradas no hay con qué filtrar (igual que en
 * el backend) y se muestran todas las vistas. Los derivados no tienen tarjeta
 * salvo conductividad25C, que acompaña a la conductividad aunque nunca se haya
 * podido calcular: justamente ahí hay que explicar por qué.
 */
export function variablesAMostrar(
  vistas: string[] | undefined, sondas?: Record<string, SondaDispositivo>,
): string[] {
  const conSondas = Object.keys(sondas ?? {}).length > 0;
  const medidas = (vistas ?? []).filter((v) => !DERIVADOS.includes(v))
    .filter((v) => !conSondas || specDe(v, sondas) !== undefined);
  const out = new Set(medidas);
  if (out.has("conductividad")) out.add("conductividad25C");
  const pos = (v: string) => { const i = ORDEN.indexOf(v); return i < 0 ? ORDEN.length : i; };
  return [...out].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
}

export type EstadoTarjeta =
  | { tipo: "normal"; valor: number }
  /** Cota inferior: el valor real es "al menos" `tope`. */
  | { tipo: "saturado"; valor: number; tope: number }
  | { tipo: "fuera_operacion"; valor: number }
  /** Conductividad cruda mostrada en la tarjeta de conductividad25C. */
  | { tipo: "sin_compensar"; valor: number; causa?: string; tope?: number }
  | { tipo: "sin_dato"; motivo: string };

/**
 * Causa de que no haya conductividad25C, SOLO si se deduce con certeza de la
 * lectura (replica las condiciones de derivarLectura). Si ninguna aplica,
 * undefined: la tarjeta queda con la etiqueta genérica.
 */
export function causaSinCompensar(lectura: UltimaLecturaDispositivo): string | undefined {
  const valores = lectura.valores ?? {};
  const confianza = lectura.confianza ?? {};
  if (confianza.conductividad === "fuera_de_operacion") return "conductividad fuera de operación";
  const tVar = TEMPERATURAS_LIQUIDO.find((k) => typeof valores[k] === "number");
  if (!tVar) return "falta la temperatura";
  if (confianza[tVar] === "saturado") return "temperatura saturada";
  if (confianza[tVar] === "fuera_de_operacion") return "temperatura fuera de operación";
  return undefined;
}

export const ETIQUETA_SIN_COMPENSAR = "sin compensar a 25 °C";

function sinDato(variable: string, l: UltimaLecturaDispositivo): EstadoTarjeta {
  const motivo = l.descartadas?.[variable];
  if (motivo) return { tipo: "sin_dato", motivo };
  if (l.valores?.[variable] === null) return { tipo: "sin_dato", motivo: "sensor no conectado" };
  return { tipo: "sin_dato", motivo: "no llegó en la última lectura" };
}

export function estadoTarjeta(
  variable: string, lectura: UltimaLecturaDispositivo | undefined,
  sondas?: Record<string, SondaDispositivo>,
): EstadoTarjeta {
  if (!lectura) return { tipo: "sin_dato", motivo: "el equipo aún no envía lecturas" };
  const valores = lectura.valores ?? {};
  const confianza = lectura.confianza ?? {};

  const numerico = (valor: number, conf: string | undefined, tope: number): EstadoTarjeta =>
    conf === "fuera_de_operacion" ? { tipo: "fuera_operacion", valor }
    : conf === "saturado" ? { tipo: "saturado", valor, tope }
    : { tipo: "normal", valor };

  if (variable === "conductividad25C") {
    const d = lectura.derivados?.conductividad25C;
    // Derivado saturado: es una cota inferior calculada, el "tope" es el propio valor
    if (typeof d === "number") return numerico(d, confianza.conductividad25C, d);
    const ec = valores.conductividad;
    if (typeof ec === "number") {
      return {
        tipo: "sin_compensar", valor: ec, causa: causaSinCompensar(lectura),
        tope: confianza.conductividad === "saturado" ? topeDe("conductividad", sondas) ?? ec : undefined,
      };
    }
    return sinDato("conductividad", lectura);
  }

  const v = valores[variable];
  if (typeof v !== "number") return sinDato(variable, lectura);
  return numerico(v, confianza[variable], topeDe(variable, sondas) ?? v);
}
