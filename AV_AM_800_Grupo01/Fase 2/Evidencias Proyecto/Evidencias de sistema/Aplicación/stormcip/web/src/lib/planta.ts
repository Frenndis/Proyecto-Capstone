// Datos y reglas de la planta, sin React ni Firestore. Mismos tipos que
// functions/src/planta/. La validación TACT sigue la maqueta Storm CIP de Austral.
import { MarcaTiempo } from "./tipos";

export type FaseCiclo = { n: string; etapa: string; s: number; sReceta: number; t: number; c: number; q: number; min: number | null; enjuague: boolean };
export type PuntoCurva = { t: number; T: number; c: number; q: number; ec: number; a: number; k: number };
export type ResumenFase = { n: string; objetivoT: number; objetivoC: number; durS: number; tMin: number | null; concMedia: number | null; limpioS: number | null; estado: "cumple" | "corregido" | "fuera" };
export type Resumen = { duracionS: number; aguaL: number; quimicoL: number; tempMinSoda: number | null; validacion: "validado" | "desvio" | "fuera"; fases: ResumenFase[] };
export type CicloPlanta = {
  id: string; v: 3; numero: string; lineaId: string; circuitoId: string; circuito: string; area: string;
  programa: string; recetaVersion: string; lead: string; operador: string;
  estado: "en_curso" | "finalizado" | "abortado"; faseIdx?: number; velocidad?: number; escenario?: string;
  fases: FaseCiclo[]; curva: PuntoCurva[]; resumen?: Resumen;
  inicio: MarcaTiempo; fin?: MarcaTiempo | null; vivoEn?: MarcaTiempo | null;
  consumos?: { aguaTotal?: number }; simulado?: boolean;
  prediccion?: PrediccionCiclo; prediccionVivo?: Record<string, { s: number; margen: number }>;
};

export type Decision = {
  id: string; tipo: "acortar_enjuague" | "ajustar_dosis" | "revisar_circuito" | "posible_fuga";
  circuitoId: string; circuito: string; fase?: string; titulo: string; hoy: string; propuesta: string;
  porque: string; aplicar: string; aguaMesL: number; quimicoMesL: number; minutosMes: number;
  aguaCicloL: number; quimicoCicloL: number; segundosCiclo: number; ciclos: number; confianza: "alta" | "media";
  configuradoS?: number; p50S?: number; p95S?: number; sugeridoS?: number; primerPasoS?: number;
};
export type PrediccionCiclo = {
  aguaL: number; aguaMargen: number; quimicoL: number; quimicoMargen: number; riesgo: number;
  limpio: Record<string, { s: number; margen: number }>;
};
export type MetricaModelo = {
  id: string; nombre: string; unidad: string; filas: number; filasPrueba: number; error: number; errorBase: number;
  mejora: number; r2: number; cobertura: number | null; margen: number; util: boolean; factores: { n: string; peso: number }[];
};
export type Prediccion = {
  ml?: PrediccionCiclo;
  circuitoId: string; circuito: string; ciclos: number; aguaL: number; aguaP10: number; aguaP90: number; aguaError: number;
  quimicoL: number; quimicoP10: number; quimicoP90: number; quimicoError: number; duracionS: number; ultimoMs: number;
};
export type Oportunidades = {
  decisiones: Decision[]; predicciones: Prediccion[];
  ml?: { metricas: MetricaModelo[]; ciclos: number; algoritmo: string; arboles: number };
  totales: { aguaMesL: number; quimicoMesL: number; minutosMes: number; aguaActualMesL: number; quimicoActualMesL: number; ciclos: number };
};
export type EstadoDecision = { estado: "aprobada" | "descartada"; por?: string; en?: MarcaTiempo | null };

// Plano en unidades 1200 × 700: distribución de la planta demo de la maqueta
export const PLANO = {
  areas: [
    ["Recepción de leche", 12, 21, 240, 259], ["Silos", 276, 21, 204, 259], ["Pasteurización", 504, 21, 288, 259],
    ["Central CIP", 816, 21, 192, 182], ["Laboratorio", 1032, 21, 156, 182], ["Bodega de químicos", 12, 308, 240, 224],
    ["Quesería", 276, 308, 204, 224], ["Envasado", 504, 308, 384, 224], ["Cámaras y despacho", 912, 231, 276, 448],
    ["Accesos y vestidores", 12, 560, 876, 119],
  ] as [string, number, number, number, number][],
  nodos: [
    { id: "and1", n: "Andén 1", x: 66, y: 110 }, { id: "and2", n: "Andén 2", x: 138, y: 196 }, { id: "and3", n: "Andén 3", x: 214, y: 110 },
    { id: "silo3", n: "Silo 3", x: 378, y: 150 }, { id: "past", n: "Pasteurizador", x: 648, y: 150 },
    { id: "tina2", n: "Tina 2", x: 378, y: 420 }, { id: "lle1", n: "Llenadora 1", x: 600, y: 420 }, { id: "lle2", n: "Llenadora 2", x: 756, y: 420 },
  ],
};
export const NOMBRES_CIRCUITO: Record<string, string> = {
  and1: "Camión recolección · andén 1", and2: "Camión interplanta · andén 2", and3: "Camión interplanta · andén 3",
  silo3: "Silo 3", past: "Pasteurizador", tina2: "Tina 2 · quesería", lle1: "Llenadora 1", lle2: "Llenadora 2",
};
/** Días libres por circuito: para saber cuántos ciclos había programados hoy. */
const LIBRES: Record<string, number[]> = { silo3: [0], tina2: [0], lle1: [0], lle2: [0, 6] };
export const programadosEn = (d: Date) => PLANO.nodos.filter((n) => !LIBRES[n.id]?.includes(d.getDay())).length;

export const nf = (n: number, d = 0) => Number(n).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d });
export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const fechaDe = (ts?: MarcaTiempo | null) => ts?.toDate?.() ?? null;
export const horaCorta = (d: Date | null) => d?.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false }) ?? "—";
export const fechaCorta = (d: Date | null) => d ? `${d.toLocaleDateString("es-CL")} · ${horaCorta(d)}` : "—";

export type Tono = "ok" | "warn" | "crit" | "live" | "idle";
export function estadoCiclo(c: Pick<CicloPlanta, "estado" | "resumen"> | undefined): { tono: Tono; texto: string } {
  if (!c) return { tono: "idle", texto: "Sin ciclo hoy" };
  if (c.estado === "en_curso") return { tono: "live", texto: "En curso" };
  if (c.estado === "abortado") return { tono: "idle", texto: "Abortado" };
  if (c.resumen?.validacion === "desvio") return { tono: "warn", texto: "Con desvío" };
  if (c.resumen?.validacion === "fuera") return { tono: "crit", texto: "Fuera de límite" };
  return { tono: "ok", texto: "Validado" };
}

export const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function resumenDia(ciclos: CicloPlanta[]) {
  const cerrados = ciclos.filter((c) => c.estado === "finalizado");
  return {
    total: ciclos.length,
    validados: cerrados.filter((c) => c.resumen?.validacion === "validado").length,
    desvios: cerrados.filter((c) => c.resumen?.validacion === "desvio").length,
    fuera: cerrados.filter((c) => c.resumen?.validacion === "fuera").length,
    aguaM3: ciclos.reduce((s, c) => s + (c.resumen?.aguaL ?? (c.consumos?.aguaTotal ?? 0) * 1000), 0) / 1000,
  };
}

export type EstadoTact = "ok" | "warn" | "wait";
export type FilaTact = { nombre: string; estado: EstadoTact; valor: string };

/**
 * Validación TACT en el instante del punto: temperatura, acción mecánica,
 * concentración y tiempo. El caudal se convierte en velocidad con línea DN 76.
 */
export function tact(f: FaseCiclo, p: PuntoCurva, dentroS: number): FilaTact[] {
  const quimica = f.c > 0.1;
  const bajaT = f.min !== null && p.T < f.min;
  const calentando = bajaT && dentroS < Math.min(150, f.s * 0.4);
  const velocidad = p.q / 3600 / 0.00407;
  const enDesvio = bajaT && !calentando;
  const drenaje = f.q < 10;
  return [
    { nombre: "Temperatura", estado: enDesvio ? "warn" : calentando ? "wait" : "ok", valor: f.min ? `${nf(p.T, 1)} °C · mín. ${f.min}` : `${nf(p.T, 1)} °C · sin mínimo` },
    { nombre: "Acción mecánica", estado: drenaje || velocidad >= 1.5 ? "ok" : "wait", valor: drenaje ? "drenaje" : `${nf(velocidad, 1)} m/s · mín. 1,5` },
    { nombre: "Concentración", estado: !quimica || Math.abs(p.c - f.c) < f.c * 0.2 ? "ok" : "wait", valor: quimica ? `${nf(p.c, 2)} % · ${nf(f.c * 0.85, 2)}–${nf(f.c * 1.2, 2)}` : f.enjuague ? `${nf(p.ec)} µS/cm · agua limpia ≤ 200` : "agua" },
    { nombre: "Tiempo", estado: dentroS / f.s > 0.98 ? "ok" : enDesvio ? "warn" : "wait", valor: enDesvio ? "conteo en pausa" : `${mmss(dentroS)} de ${mmss(f.s)}` },
  ];
}

/** Frase corta para el operador: qué está pasando ahora. */
export function aviso(f: FaseCiclo, p: PuntoCurva, dentroS: number, cerrado: boolean, c: Pick<CicloPlanta, "numero" | "resumen">): { tono: "info" | "ok" | "warn" | "crit"; texto: string } {
  if (cerrado) {
    const v = c.resumen?.validacion;
    if (v === "fuera") return { tono: "crit", texto: `Ciclo fuera de límite. Registro ${c.numero} emitido: el circuito no se libera.` };
    if (v === "desvio") return { tono: "ok", texto: `Desvío corregido: la fase se extendió 2 min. Registro ${c.numero} emitido.` };
    return { tono: "ok", texto: `Ciclo validado. Registro ${c.numero} emitido.` };
  }
  if (f.min !== null && p.T < f.min && dentroS >= Math.min(150, f.s * 0.4)) {
    return { tono: "warn", texto: `Temperatura bajo ${f.min} °C. Storm CIP pausa el conteo de la fase y avisa a mantención.` };
  }
  if (f.enjuague && p.ec <= 200) {
    return { tono: "ok", texto: `Agua limpia a los ${mmss(dentroS)} de ${mmss(f.s)}. Lo que queda de esta fase es agua que ya no limpia nada.` };
  }
  return { tono: "info", texto: `Fase «${f.n}»: objetivo ${f.t} °C${f.c > 0.1 ? ` · ${nf(f.c, 1)} %` : ""}` };
}

export const inicioFase = (fases: FaseCiclo[], i: number) => fases.slice(0, i).reduce((a, f) => a + f.s, 0);
export function faseEn(fases: FaseCiclo[], t: number) {
  let a = 0;
  for (let i = 0; i < fases.length; i++) { a += fases[i].s; if (t < a) return i; }
  return fases.length - 1;
}

const DIA_MS = 86400000;
export type PeriodoConsumo = { aguaL: number; quimicoL: number; horas: number; ciclos: number };
export function periodo(ciclos: CicloPlanta[], desdeMs: number, hastaMs: number): PeriodoConsumo {
  const f = ciclos.filter((c) => { const t = fechaDe(c.inicio)?.getTime() ?? 0; return t >= desdeMs && t < hastaMs && c.resumen; });
  return {
    aguaL: f.reduce((s, c) => s + c.resumen!.aguaL, 0), quimicoL: f.reduce((s, c) => s + c.resumen!.quimicoL, 0),
    horas: f.reduce((s, c) => s + c.resumen!.duracionS, 0) / 3600, ciclos: f.length,
  };
}
/** "▼ 7 % vs 30 días anteriores". Sin período anterior, nada. */
export function variacion(actual: number, previo: number) {
  if (!previo) return { texto: "", baja: true };
  const p = (actual / previo - 1) * 100;
  return { texto: `${p <= 0 ? "▼" : "▲"} ${nf(Math.abs(p))} % vs mes anterior`, baja: p <= 0 };
}
export function aguaPorDia(ciclos: CicloPlanta[], hoy: Date, dias = 30) {
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Array.from({ length: dias }, (_, i) => {
    const desde = base - (dias - 1 - i) * DIA_MS;
    return { dia: new Date(desde), m3: periodo(ciclos, desde, desde + DIA_MS).aguaL / 1000 };
  });
}
export function aguaPorCircuito(ciclos: CicloPlanta[], desdeMs: number) {
  const m = new Map<string, number>();
  for (const c of ciclos) if (c.resumen && (fechaDe(c.inicio)?.getTime() ?? 0) >= desdeMs) m.set(c.circuito, (m.get(c.circuito) ?? 0) + c.resumen.aguaL);
  return [...m.entries()].map(([n, l]) => ({ n, m3: l / 1000 })).sort((a, b) => b.m3 - a.m3);
}
export function semanas(ciclos: CicloPlanta[], hoy: Date, n = 5) {
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1).getTime();
  return Array.from({ length: n }, (_, i) => {
    const hasta = fin - (n - 1 - i) * 7 * DIA_MS, desde = hasta - 7 * DIA_MS;
    const f = ciclos.filter((c) => { const t = fechaDe(c.inicio)?.getTime() ?? 0; return t >= desde && t < hasta && c.resumen; });
    const val = f.filter((c) => c.resumen!.validacion === "validado").length;
    return { etiqueta: new Date(desde).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }), pct: f.length ? (val / f.length) * 100 : 0, desvios: f.length - val, ciclos: f.length };
  });
}
