// Planes de limpieza CIP editables: valida lo que envía el administrador y lo
// convierte al `Circuito` que usa el motor. Sin Firestore, para poder testearlo.
import type { Etapa } from "../types";
import { Circuito, Fase } from "./motor";

/** Tipos de fase admitidos. El nombre de la fase es su tipo: una de cada uno por plan. */
export const TIPOS_FASE = ["Preenjuague", "Soda", "Monofase", "Enjuague", "Ácido", "Enjuague final", "Drenaje"] as const;
export type TipoFase = (typeof TIPOS_FASE)[number];

const ETAPA: Record<TipoFase, Etapa> = {
  Preenjuague: "preenjuague", Soda: "alcalino", Monofase: "alcalino", Enjuague: "enjuague",
  "Ácido": "acido", "Enjuague final": "enjuague_final", Drenaje: "desinfeccion",
};
const QUIMICAS: TipoFase[] = ["Soda", "Monofase", "Ácido"];

/** Lo que edita el administrador en cada fase. */
export type FaseEntrada = {
  n: string;
  /** Duración en minutos. */
  min: number;
  /** Temperatura objetivo, °C. */
  t: number;
  /** Concentración objetivo, % (0 en fases de agua). */
  c?: number;
  /** Temperatura mínima de validación, °C. Vacío = sin mínimo. */
  tMin?: number | null;
  /** Caudal, m³/h. */
  q?: number;
};

export type PlanEntrada = {
  id?: string; nombre: string; corto?: string; area: string; receta: string; lead?: string;
  hora?: number; libres?: number[]; activo?: boolean; fases: FaseEntrada[];
};

/** Un plan es un circuito con su receta, más si está vigente. */
export type Plan = Circuito & { activo: boolean };

export class ErrorPlan extends Error {}

const num = (v: unknown, nombre: string, min: number, max: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
    throw new ErrorPlan(`${nombre}: debe estar entre ${min} y ${max}`);
  }
  return n;
};
const texto = (v: unknown, nombre: string, max: number, obligatorio = true): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (obligatorio && !s) throw new ErrorPlan(`${nombre}: no puede quedar vacío`);
  if (s.length > max) throw new ErrorPlan(`${nombre}: máximo ${max} caracteres`);
  return s;
};

/** Identificador a partir del nombre: "Tina 3 · quesería" → "tina-3-queseria". */
export function idDesdeNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function faseDe(e: FaseEntrada, i: number): Fase {
  const donde = `Fase ${i + 1}`;
  if (!TIPOS_FASE.includes(e?.n as TipoFase)) throw new ErrorPlan(`${donde}: tipo de fase desconocido`);
  const n = e.n as TipoFase;
  const quimica = QUIMICAS.includes(n);
  const minutos = num(e.min, `${donde} (${n}), duración`, 0.5, 180);
  const t = num(e.t, `${donde} (${n}), temperatura`, 5, 95);
  const c = quimica ? num(e.c, `${donde} (${n}), concentración`, 0.1, 5) : 0;
  const tMin = e.tMin === null || e.tMin === undefined || (e.tMin as unknown) === ""
    ? null : num(e.tMin, `${donde} (${n}), temperatura mínima`, 5, 95);
  if (tMin !== null && tMin > t) throw new ErrorPlan(`${donde} (${n}): la temperatura mínima no puede superar el objetivo`);
  const porDefecto = n === "Drenaje" ? 4 : quimica ? 26 : 24;
  const q = e.q === undefined || e.q === null || (e.q as unknown) === "" ? porDefecto : num(e.q, `${donde} (${n}), caudal`, 1, 80);
  return {
    n, etapa: ETAPA[n], s: Math.round(minutos * 60), t, c, q,
    chem: +(c * 1.5).toFixed(2), fresh: n === "Drenaje" ? 0 : quimica ? 0.1 : 0.45, min: tMin,
    enjuague: n === "Enjuague" || n === "Enjuague final",
  };
}

/**
 * Valida la entrada y arma el plan. `previo` es el plan que se está modificando:
 * conserva lo que el formulario no edita (comportamiento del circuito en la
 * simulación y la fracción de agua de red de las fases que no cambian de tipo).
 */
export function normalizarPlan(entrada: PlanEntrada, previo?: Plan): Plan {
  if (!entrada || typeof entrada !== "object") throw new ErrorPlan("Plan inválido");
  const nombre = texto(entrada.nombre, "Nombre", 80);
  const id = previo?.id ?? (entrada.id ? texto(entrada.id, "Identificador", 40) : idDesdeNombre(nombre));
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw new ErrorPlan("Identificador: usa de 2 a 40 letras minúsculas, números o guiones");
  if (!Array.isArray(entrada.fases) || entrada.fases.length < 1 || entrada.fases.length > TIPOS_FASE.length) {
    throw new ErrorPlan("El plan necesita entre 1 y 7 fases");
  }
  const fases = entrada.fases.map(faseDe).map((f) => {
    const antes = previo?.fases.find((x) => x.n === f.n);
    return antes ? { ...f, fresh: antes.fresh } : f;
  });
  const repetida = fases.find((f, i) => fases.findIndex((x) => x.n === f.n) !== i);
  if (repetida) throw new ErrorPlan(`La fase «${repetida.n}» está repetida: cada tipo de fase va una sola vez`);
  if (!fases.some((f) => f.s > 0 && f.q > 0)) throw new ErrorPlan("El plan no tiene fases con caudal");

  const libres = [...new Set((entrada.libres ?? previo?.libres ?? []).map((d) => num(d, "Días sin ciclo", 0, 6)))].sort();
  if (libres.length >= 7) throw new ErrorPlan("Días sin ciclo: debe quedar al menos un día con limpieza");
  return {
    id, nombre,
    corto: texto(entrada.corto, "Nombre corto", 24, false) || nombre.slice(0, 24),
    area: texto(entrada.area, "Área", 40),
    receta: texto(entrada.receta, "Receta", 60),
    lead: texto(entrada.lead, "Descripción", 120, false),
    fases,
    fraccionLimpio: previo?.fraccionLimpio ?? 0.65,
    pDesvio: previo?.pDesvio ?? 0.02,
    sobredosis: previo?.sobredosis ?? 1,
    hora: Math.round(num(entrada.hora ?? previo?.hora ?? 8, "Hora programada", 0, 23)),
    libres,
    activo: entrada.activo ?? previo?.activo ?? true,
  };
}

/** Un documento de Firestore puede venir incompleto o editado a mano: se descarta si no sirve. */
export function planDesdeDoc(id: string, d: Record<string, unknown> | undefined): Plan | null {
  if (!d || !Array.isArray(d.fases) || d.fases.length === 0 || typeof d.nombre !== "string") return null;
  const fases = (d.fases as Fase[]).filter((f) => f && typeof f.n === "string" && typeof f.s === "number");
  if (fases.length !== (d.fases as unknown[]).length) return null;
  const n = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  return {
    id, nombre: d.nombre, corto: typeof d.corto === "string" ? d.corto : d.nombre.slice(0, 24),
    area: typeof d.area === "string" ? d.area : "", receta: typeof d.receta === "string" ? d.receta : d.nombre,
    lead: typeof d.lead === "string" ? d.lead : "", fases,
    fraccionLimpio: n(d.fraccionLimpio, 0.65), pDesvio: n(d.pDesvio, 0.02), sobredosis: n(d.sobredosis, 1),
    hora: n(d.hora, 8), libres: Array.isArray(d.libres) ? (d.libres as number[]) : [], activo: d.activo !== false,
  };
}
