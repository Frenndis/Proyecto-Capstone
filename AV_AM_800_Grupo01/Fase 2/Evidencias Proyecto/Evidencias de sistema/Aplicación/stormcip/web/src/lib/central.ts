// Lógica pura de Central, Registros, Consumos y Predicción. Sin React ni Firestore.
import { Ciclo } from "./tipos";

export type LineaPlanta = { id: string; nombre: string; plantaNombre: string };
export type ConfigCalculos = {
  factorCompensacionEC?: number; conductividadAguaRed?: number; caudalNominalM3h?: number;
  criterioLimpio?: { conductividad25C?: number; turbidez?: number };
};

// Mismos estados que functions/src/modelosCiclo.ts
export type Recomendacion =
  | { estado: "faltan_ciclos"; ciclos: number; requeridos: number }
  | { estado: "sin_configuracion"; ciclos: number }
  | { estado: "inestable"; ciclos: number; tasaSinLimpiar: number }
  | { estado: "sin_ahorro"; ciclos: number; configuradoS: number; p95S: number }
  | { estado: "sugerencia"; ciclos: number; configuradoS: number; p95S: number;
      sugeridoS: number; siguientePasoS: number; ahorroAguaL: number; ahorroPasoL: number };
export type PrediccionConsumo =
  | { estado: "faltan_ciclos"; ciclos: number; requeridos: number }
  | { estado: "listo"; ciclos: number; esperado: number; p10: number; p90: number; errorMedio: number };
export type ModeloPrograma = {
  lineaId: string; programa: string; ciclos: number; conDatosSimulados: boolean; caudalM3h: number;
  etapas: Record<string, Recomendacion>;
  consumo: { aguaTotal: PrediccionConsumo; soda: PrediccionConsumo; acido: PrediccionConsumo };
};
export type Modelos = Record<string, ModeloPrograma>;

export type EstadoCiclo = { tono: "ok" | "warn" | "crit" | "accent" | "neutro"; texto: string };

/** Un ciclo cerrado cumple si su enjuague final llegó al criterio de agua limpia. */
export function estadoDeCiclo(c: Pick<Ciclo, "estado" | "indicadores" | "indicadoresCalculadosEn">): EstadoCiclo {
  if (c.estado === "en_curso") return { tono: "accent", texto: "En curso" };
  if (c.estado === "abortado") return { tono: "neutro", texto: "Abortado" };
  if (!c.indicadoresCalculadosEn) return { tono: "neutro", texto: "Calculando" };
  return typeof c.indicadores?.tiempoHastaLimpio === "number"
    ? { tono: "ok", texto: "Agua limpia" }
    : { tono: "crit", texto: "Sin agua limpia" };
}

const fechaDe = (ts: { toDate?: () => Date } | null | undefined) => ts?.toDate?.() ?? null;

export const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function resumenDe(ciclos: Ciclo[]) {
  const cerrados = ciclos.filter((c) => c.estado === "finalizado");
  return {
    total: ciclos.length,
    enCurso: ciclos.filter((c) => c.estado === "en_curso").length,
    limpios: cerrados.filter((c) => estadoDeCiclo(c).tono === "ok").length,
    sinLimpiar: cerrados.filter((c) => estadoDeCiclo(c).tono === "crit").length,
    aguaM3: ciclos.reduce((s, c) => s + (c.consumos?.aguaTotal ?? 0), 0),
  };
}

export const ciclosDelDia = (ciclos: Ciclo[], dia: Date) =>
  ciclos.filter((c) => { const f = fechaDe(c.inicio); return f !== null && mismoDia(f, dia); });

export function duracionMin(c: Pick<Ciclo, "inicio" | "fin">): number | null {
  const i = fechaDe(c.inicio), f = fechaDe(c.fin);
  return i && f ? (f.getTime() - i.getTime()) / 60000 : null;
}

export type FilaConsumo = { clave: string; ciclos: number; aguaM3: number; recuperadaM3: number; sodaL: number; acidoL: number };

/** Totales por programa, de mayor a menor consumo de agua. */
export function consumoPorPrograma(ciclos: Ciclo[]): FilaConsumo[] {
  const filas = new Map<string, FilaConsumo>();
  for (const c of ciclos) {
    if (c.estado !== "finalizado" || !c.consumos) continue;
    const clave = c.programa ?? "Sin programa";
    const f = filas.get(clave) ?? { clave, ciclos: 0, aguaM3: 0, recuperadaM3: 0, sodaL: 0, acidoL: 0 };
    f.ciclos += 1;
    f.aguaM3 += c.consumos.aguaTotal ?? 0;
    f.recuperadaM3 += c.consumos.aguaRecuperada ?? 0;
    f.sodaL += c.consumos.soda ?? 0;
    f.acidoL += c.consumos.acido ?? 0;
    filas.set(clave, f);
  }
  return [...filas.values()].sort((a, b) => b.aguaM3 - a.aguaM3);
}

export type PuntoDia = { dia: string; aguaM3: number; ciclos: number };

/** Agua por día de los últimos `dias`, incluidos los días sin ciclos. */
export function aguaPorDia(ciclos: Ciclo[], hoy: Date, dias = 30): PuntoDia[] {
  const out: PuntoDia[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i);
    const delDia = ciclosDelDia(ciclos, d).filter((c) => c.estado === "finalizado");
    out.push({
      dia: d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }),
      aguaM3: +delDia.reduce((s, c) => s + (c.consumos?.aguaTotal ?? 0), 0).toFixed(3),
      ciclos: delDia.length,
    });
  }
  return out;
}

export const formatoTiempo = (s: number) => (s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1).replace(".", ",")} min`);

export function ahorroTotalPorCiclo(m: ModeloPrograma): number {
  return Object.values(m.etapas).reduce((s, r) => s + (r.estado === "sugerencia" ? r.ahorroAguaL : 0), 0);
}
